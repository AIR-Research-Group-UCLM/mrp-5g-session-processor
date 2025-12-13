import { exec } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import OpenAI from "openai";
import { config } from "../../config/index.js";
import { logger } from "../../config/logger.js";
import { getDb } from "../../db/connection.js";
import { s3Service } from "../s3.service.js";

const execAsync = promisify(exec);

const openai = new OpenAI({
  apiKey: config.openai.apiKey,
});

interface DbSession {
  video_s3_key: string;
}

interface DiarizedSegment {
  speaker: string;
  text: string;
  start: number;
  end: number;
}

interface TranscriptionResponse {
  text: string;
  segments?: DiarizedSegment[];
  words?: Array<{
    word: string;
    start: number;
    end: number;
    speaker?: string;
  }>;
}

export async function processTranscription(sessionId: string): Promise<void> {
  const db = getDb();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "mrp-"));

  try {
    const session = db
      .prepare("SELECT video_s3_key FROM medical_sessions WHERE id = ?")
      .get(sessionId) as DbSession | undefined;

    if (!session?.video_s3_key) {
      throw new Error("Session or video not found");
    }

    const videoUrl = await s3Service.getPresignedUrl(session.video_s3_key);
    const videoPath = path.join(tempDir, "video.mp4");
    const audioPath = path.join(tempDir, "audio.mp3");

    logger.info({ sessionId, videoS3Key: session.video_s3_key }, "Downloading video from S3");

    const downloadResponse = await fetch(videoUrl);
    if (!downloadResponse.ok) {
      throw new Error(
        `Failed to download video: ${downloadResponse.status} ${downloadResponse.statusText}`
      );
    }
    const videoBuffer = Buffer.from(await downloadResponse.arrayBuffer());
    await fs.writeFile(videoPath, videoBuffer);

    const videoStats = await fs.stat(videoPath);
    logger.info({ sessionId, videoSizeBytes: videoStats.size, videoPath }, "Video downloaded");

    logger.info({ sessionId }, "Extracting audio with ffmpeg");

    try {
      const { stdout: ffmpegOut, stderr: ffmpegErr } = await execAsync(
        `ffmpeg -i "${videoPath}" -vn -acodec libmp3lame -ar 16000 -ac 1 -q:a 4 "${audioPath}" -y 2>&1`
      );
      logger.debug({ sessionId, ffmpegOut, ffmpegErr }, "ffmpeg output");
    } catch (ffmpegError) {
      const err = ffmpegError as Error & { stdout?: string; stderr?: string };
      logger.error(
        { sessionId, error: err.message, stdout: err.stdout, stderr: err.stderr },
        "ffmpeg failed"
      );
      throw new Error(`ffmpeg extraction failed: ${err.message}`);
    }

    const audioStats = await fs.stat(audioPath);
    logger.info({ sessionId, audioSizeBytes: audioStats.size, audioPath }, "Audio extracted");

    const { stdout: durationOutput } = await execAsync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${videoPath}"`
    );
    const durationSeconds = Math.round(parseFloat(durationOutput.trim()));

    logger.info(
      { sessionId, durationSeconds, audioSizeBytes: audioStats.size, model: config.openai.models.transcription },
      "Transcribing audio"
    );

    const audioFile = await fs.readFile(audioPath);
    const audioBlob = new Blob([audioFile], { type: "audio/mp3" });
    const file = new File([audioBlob], "audio.mp3", { type: "audio/mp3" });

    logger.debug({ sessionId, fileSizeBytes: audioFile.length }, "Audio file prepared for OpenAI");

    // Use transcription model with diarization support
    let transcription: TranscriptionResponse;
    try {
      transcription = (await openai.audio.transcriptions.create({
        file,
        model: config.openai.models.transcription,
        response_format: "diarized_json",
        chunking_strategy: "auto",
      })) as TranscriptionResponse;
    } catch (openaiError) {
      const err = openaiError as Error & { status?: number; response?: unknown };
      logger.error(
        {
          sessionId,
          error: err.message,
          status: err.status,
          response: err.response,
        },
        "OpenAI transcription failed"
      );
      throw err;
    }

    logger.info(
      {
        sessionId,
        textLength: transcription.text?.length,
        segmentCount: transcription.segments?.length,
        wordCount: transcription.words?.length,
        hasText: !!transcription.text,
      },
      "Transcription received"
    );

    // Trim whitespace from all text fields
    const transcriptData = {
      text: transcription.text?.trim() ?? "",
      segments: (transcription.segments ?? []).map((seg) => ({
        ...seg,
        text: seg.text?.trim() ?? "",
      })),
      words: (transcription.words ?? []).map((w) => ({
        ...w,
        word: w.word?.trim() ?? "",
      })),
      duration: durationSeconds,
    };

    db.prepare(
      `
      UPDATE medical_sessions
      SET video_duration_seconds = ?, updated_at = datetime('now')
      WHERE id = ?
    `
    ).run(durationSeconds, sessionId);

    const transcriptPath = path.join(tempDir, "transcript.json");
    await fs.writeFile(transcriptPath, JSON.stringify(transcriptData, null, 2));

    const transcriptS3Key = session.video_s3_key.replace(/\.[^.]+$/, "_transcript.json");
    await s3Service.uploadFile(transcriptS3Key, transcriptPath, "application/json");

    logger.info({ sessionId }, "Transcription completed and saved");
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}
