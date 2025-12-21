import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { config } from "../../config/index.js";
import { logger } from "../../config/logger.js";

const execFileAsync = promisify(execFile);

// Security: Use execFile with argument arrays to prevent command injection
async function runFfmpeg(args: string[]): Promise<{ stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync("ffmpeg", args);
    return { stdout: stdout ?? "", stderr: stderr ?? "" };
  } catch (error) {
    const err = error as Error & { stdout?: string; stderr?: string };
    throw Object.assign(new Error(err.message), {
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? "",
    });
  }
}

async function runFfprobe(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("ffprobe", args);
  return stdout;
}

const elevenlabs = new ElevenLabsClient({
  apiKey: config.elevenlabs.apiKey,
});

export interface SegmentAudioResult {
  characterCount: number;
}

export async function generateSegmentAudio(
  text: string,
  voiceId: string,
  outputPath: string
): Promise<SegmentAudioResult> {
  const characterCount = text.length;
  logger.debug({ voiceId, textLength: characterCount }, "Generating audio for segment");

  const audioStream = await elevenlabs.textToSpeech.convert(voiceId, {
    text,
    modelId: "eleven_multilingual_v2",
    outputFormat: "mp3_44100_128",
  });

  // Convert stream to buffer and write to file
  const chunks: Buffer[] = [];
  for await (const chunk of audioStream) {
    chunks.push(Buffer.from(chunk));
  }
  const audioBuffer = Buffer.concat(chunks);

  await fs.writeFile(outputPath, audioBuffer);

  logger.debug({ outputPath, sizeBytes: audioBuffer.length, characterCount }, "Segment audio generated");

  return { characterCount };
}

export async function generateSilence(
  durationMs: number,
  outputPath: string
): Promise<void> {
  const durationSec = (durationMs / 1000).toString();

  await runFfmpeg([
    "-f", "lavfi",
    "-i", "anullsrc=r=44100:cl=stereo",
    "-t", durationSec,
    "-acodec", "libmp3lame",
    outputPath,
    "-y",
  ]);

  logger.debug({ durationMs, outputPath }, "Silence generated");
}

export async function concatenateAudioFiles(
  segmentPaths: string[],
  outputPath: string,
  pauseMs: number,
  tempDir: string
): Promise<void> {
  if (segmentPaths.length === 0) {
    throw new Error("No audio segments to concatenate");
  }

  // Generate silence file
  const silencePath = path.join(tempDir, "silence.mp3");
  await generateSilence(pauseMs, silencePath);

  // Create concat list file with segments interleaved with silence
  const concatListPath = path.join(tempDir, "concat.txt");
  const concatLines: string[] = [];

  for (let i = 0; i < segmentPaths.length; i++) {
    concatLines.push(`file '${segmentPaths[i]}'`);
    // Add silence between segments (not after the last one)
    if (i < segmentPaths.length - 1) {
      concatLines.push(`file '${silencePath}'`);
    }
  }

  await fs.writeFile(concatListPath, concatLines.join("\n"));

  logger.info(
    { segmentCount: segmentPaths.length, pauseMs, concatListPath },
    "Concatenating audio files"
  );

  // Concatenate using ffmpeg
  try {
    const { stdout, stderr } = await runFfmpeg([
      "-f", "concat",
      "-safe", "0",
      "-i", concatListPath,
      "-acodec", "libmp3lame",
      "-ar", "44100",
      "-ac", "2",
      "-q:a", "2",
      outputPath,
      "-y",
    ]);
    logger.debug({ stdout, stderr }, "ffmpeg concat output");
  } catch (error) {
    const err = error as Error & { stdout?: string; stderr?: string };
    logger.error(
      { error: err.message, stdout: err.stdout, stderr: err.stderr },
      "ffmpeg concat failed"
    );
    throw new Error(`ffmpeg concat failed: ${err.message}`);
  }

  const stats = await fs.stat(outputPath);
  logger.info(
    { outputPath, sizeBytes: stats.size, segmentCount: segmentPaths.length },
    "Audio concatenation completed"
  );
}

export async function getAudioDuration(audioPath: string): Promise<number> {
  const stdout = await runFfprobe([
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    audioPath,
  ]);
  return Math.round(parseFloat(stdout.trim()));
}
