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

interface LanguageDetectionResult {
  language: string;
  costUsd: number;
}

async function detectLanguageFromText(text: string): Promise<LanguageDetectionResult> {
  if (!text || text.trim().length < 10) {
    return { language: "es", costUsd: 0 }; // Default to Spanish for very short or empty text
  }

  const sampleText = text.slice(0, 500); // Use first 500 chars for detection

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You are a language detection assistant. Respond with ONLY the ISO 639-1 language code (e.g., 'en', 'es', 'fr', 'de', 'pt', 'it', 'nl', 'ru', 'zh', 'ja', 'ko', 'ar'). Do not include any explanation or additional text.",
        },
        {
          role: "user",
          content: `Detect the language of this text:\n\n${sampleText}`,
        },
      ],
      max_tokens: 5,
      temperature: 0,
    });

    const detectedCode = response.choices[0]?.message?.content?.trim().toLowerCase() ?? "es";

    // Calculate cost for gpt-4o-mini (using standard pricing: $0.15/1M input, $0.60/1M output)
    const inputTokens = response.usage?.prompt_tokens ?? 0;
    const outputTokens = response.usage?.completion_tokens ?? 0;
    const costUsd = (inputTokens / 1_000_000) * 0.15 + (outputTokens / 1_000_000) * 0.60;

    // Validate it's a 2-letter code
    if (/^[a-z]{2}$/.test(detectedCode)) {
      return { language: detectedCode, costUsd };
    }
    return { language: "es", costUsd };
  } catch (error) {
    logger.warn({ error }, "Language detection failed, defaulting to Spanish");
    return { language: "es", costUsd: 0 };
  }
}

interface DbSession {
  video_s3_key: string;
  video_mime_type: string | null;
}

const AUDIO_MIMETYPES = [
  "audio/mpeg",
  "audio/mp4",
  "audio/wav",
  "audio/x-wav",
  "audio/ogg",
  "audio/webm",
];

function isAudioFile(mimeType: string | null): boolean {
  return mimeType ? AUDIO_MIMETYPES.includes(mimeType) : false;
}

interface DiarizedSegment {
  speaker: string;
  text: string;
  start: number;
  end: number;
}

interface TranscriptionResponse {
  text: string;
  language?: string; // ISO 639-1 code (e.g., "es", "en")
  segments?: DiarizedSegment[];
  words?: Array<{
    word: string;
    start: number;
    end: number;
    speaker?: string;
  }>;
}

export interface TranscriptionCostResult {
  audioDurationSeconds: number;
  costUsd: number;
}

export async function processTranscription(sessionId: string): Promise<TranscriptionCostResult> {
  const db = getDb();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "mrp-"));

  try {
    const session = db
      .prepare("SELECT video_s3_key, video_mime_type FROM medical_sessions WHERE id = ?")
      .get(sessionId) as DbSession | undefined;

    if (!session?.video_s3_key) {
      throw new Error("Session or media file not found");
    }

    const isAudio = isAudioFile(session.video_mime_type);
    const mediaUrl = await s3Service.getPresignedUrl(session.video_s3_key);
    const mediaExt = path.extname(session.video_s3_key) || (isAudio ? ".mp3" : ".mp4");
    const mediaPath = path.join(tempDir, `media${mediaExt}`);
    const audioPath = path.join(tempDir, "audio.mp3");

    logger.info(
      { sessionId, s3Key: session.video_s3_key, isAudio, mimeType: session.video_mime_type },
      "Downloading media from S3"
    );

    const downloadResponse = await fetch(mediaUrl);
    if (!downloadResponse.ok) {
      throw new Error(
        `Failed to download media: ${downloadResponse.status} ${downloadResponse.statusText}`
      );
    }
    const mediaBuffer = Buffer.from(await downloadResponse.arrayBuffer());
    await fs.writeFile(mediaPath, mediaBuffer);

    const mediaStats = await fs.stat(mediaPath);
    logger.info({ sessionId, mediaSizeBytes: mediaStats.size, mediaPath, isAudio }, "Media downloaded");

    if (isAudio) {
      // For audio files, convert to mp3 format suitable for transcription
      logger.info({ sessionId }, "Converting audio with ffmpeg");
      try {
        const { stdout: ffmpegOut, stderr: ffmpegErr } = await execAsync(
          `ffmpeg -i "${mediaPath}" -acodec libmp3lame -ar 16000 -ac 1 -q:a 4 "${audioPath}" -y 2>&1`
        );
        logger.debug({ sessionId, ffmpegOut, ffmpegErr }, "ffmpeg audio conversion output");
      } catch (ffmpegError) {
        const err = ffmpegError as Error & { stdout?: string; stderr?: string };
        logger.error(
          { sessionId, error: err.message, stdout: err.stdout, stderr: err.stderr },
          "ffmpeg audio conversion failed"
        );
        throw new Error(`ffmpeg audio conversion failed: ${err.message}`);
      }
    } else {
      // For video files, extract audio
      logger.info({ sessionId }, "Extracting audio from video with ffmpeg");
      try {
        const { stdout: ffmpegOut, stderr: ffmpegErr } = await execAsync(
          `ffmpeg -i "${mediaPath}" -vn -acodec libmp3lame -ar 16000 -ac 1 -q:a 4 "${audioPath}" -y 2>&1`
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
    }

    const audioStats = await fs.stat(audioPath);
    logger.info({ sessionId, audioSizeBytes: audioStats.size, audioPath }, "Audio ready for transcription");

    // Get duration from the audio file (works for both audio and video sources)
    const { stdout: durationOutput } = await execAsync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${audioPath}"`
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

    // Detect language from transcript text if API doesn't provide it
    // (diarized_json format doesn't include language field)
    let detectedLanguage = transcription.language;
    let languageDetectionCostUsd = 0;
    if (!detectedLanguage && transcription.text) {
      logger.info({ sessionId }, "Detecting language from transcript text");
      const detection = await detectLanguageFromText(transcription.text);
      detectedLanguage = detection.language;
      languageDetectionCostUsd = detection.costUsd;
    }
    detectedLanguage = detectedLanguage ?? "es";

    logger.info(
      {
        sessionId,
        textLength: transcription.text?.length,
        segmentCount: transcription.segments?.length,
        wordCount: transcription.words?.length,
        hasText: !!transcription.text,
        language: detectedLanguage,
      },
      "Transcription received"
    );

    // Trim whitespace from all text fields
    const transcriptData = {
      text: transcription.text?.trim() ?? "",
      language: detectedLanguage,
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
      SET video_duration_seconds = ?, language = ?, updated_at = datetime('now')
      WHERE id = ?
    `
    ).run(durationSeconds, detectedLanguage, sessionId);

    const transcriptPath = path.join(tempDir, "transcript.json");
    await fs.writeFile(transcriptPath, JSON.stringify(transcriptData, null, 2));

    const transcriptS3Key = session.video_s3_key.replace(/\.[^.]+$/, "_transcript.json");
    await s3Service.uploadFile(transcriptS3Key, transcriptPath, "application/json");

    // Calculate cost: duration in minutes * price per minute + language detection cost
    const transcriptionCostUsd = (durationSeconds / 60) * config.pricing.openai.transcriptionPerMinute;
    const costUsd = transcriptionCostUsd + languageDetectionCostUsd;

    logger.info(
      { sessionId, durationSeconds, transcriptionCostUsd, languageDetectionCostUsd, costUsd },
      "Transcription completed and saved"
    );

    return { audioDurationSeconds: durationSeconds, costUsd };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}
