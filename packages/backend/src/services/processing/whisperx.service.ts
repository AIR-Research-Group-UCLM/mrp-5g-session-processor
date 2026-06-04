import fs from "node:fs/promises";
import { config } from "../../config/index.js";
import { logger } from "../../config/logger.js";

/**
 * Client for the local WhisperX sidecar service (see `whisperx-service/`).
 *
 * The sidecar holds a single model instance behind an internal work queue: it
 * cold-starts the model on the first job, keeps it warm for a configurable idle
 * window, then releases GPU/RAM. We therefore submit a job and poll for the
 * result rather than holding one long HTTP request open.
 *
 * Output is normalized to the same shape the OpenAI transcription path produces,
 * so everything downstream (segmentation, summary, validator) is unchanged.
 */

export interface WhisperXSegment {
  speaker: string;
  text: string;
  start: number;
  end: number;
}

export interface WhisperXWord {
  word: string;
  start: number;
  end: number;
  speaker?: string;
}

export interface WhisperXResult {
  text: string;
  language?: string;
  segments: WhisperXSegment[];
  words: WhisperXWord[];
  duration?: number;
}

interface JobStatusResponse {
  status: "queued" | "running" | "done" | "error";
  result?: WhisperXResult;
  error?: string;
}

interface TranscribeOptions {
  sessionId: string;
  /** ISO 639-1 language code; when omitted the sidecar auto-detects. */
  language?: string;
  /** "cpu" | "cuda" — forwarded so the app .env stays the source of truth. */
  device: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function submitJob(audioPath: string, options: TranscribeOptions): Promise<string> {
  const audioBuffer = await fs.readFile(audioPath);
  const form = new FormData();
  form.append("audio", new Blob([audioBuffer], { type: "audio/mpeg" }), "audio.mp3");
  form.append("device", options.device);
  if (options.language) {
    form.append("language", options.language);
  }

  const res = await fetch(`${config.transcription.whisperx.serviceUrl}/jobs`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(60_000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`WhisperX sidecar rejected job (${res.status}): ${body.slice(0, 500)}`);
  }

  const data = (await res.json()) as { jobId?: string };
  if (!data.jobId) {
    throw new Error("WhisperX sidecar did not return a jobId");
  }
  return data.jobId;
}

async function pollJob(jobId: string, sessionId: string): Promise<WhisperXResult> {
  const { serviceUrl, pollIntervalMs, requestTimeoutMs } = config.transcription.whisperx;
  const deadline = Date.now() + requestTimeoutMs;

  while (Date.now() < deadline) {
    await sleep(pollIntervalMs);

    let status: JobStatusResponse;
    try {
      const res = await fetch(`${serviceUrl}/jobs/${jobId}`, {
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`status ${res.status}: ${body.slice(0, 200)}`);
      }
      status = (await res.json()) as JobStatusResponse;
    } catch (error) {
      // Transient polling failures (sidecar busy / restarting) are non-fatal until the deadline.
      logger.warn({ sessionId, jobId, error }, "WhisperX poll failed, retrying");
      continue;
    }

    if (status.status === "done") {
      if (!status.result) {
        throw new Error("WhisperX job completed without a result payload");
      }
      return status.result;
    }
    if (status.status === "error") {
      throw new Error(`WhisperX job failed: ${status.error ?? "unknown error"}`);
    }
    // queued | running -> keep polling
  }

  throw new Error(
    `WhisperX job ${jobId} timed out after ${Math.round(requestTimeoutMs / 1000)}s`
  );
}

/**
 * Transcribe a local audio file via the WhisperX sidecar.
 * @param audioPath path to a 16 kHz mono mp3 (already produced by ffmpeg upstream)
 */
export async function transcribeWithWhisperX(
  audioPath: string,
  options: TranscribeOptions
): Promise<WhisperXResult> {
  logger.info(
    { sessionId: options.sessionId, device: options.device, serviceUrl: config.transcription.whisperx.serviceUrl },
    "Submitting transcription to local WhisperX sidecar"
  );
  const jobId = await submitJob(audioPath, options);
  logger.info({ sessionId: options.sessionId, jobId }, "WhisperX job queued, polling for result");
  const result = await pollJob(jobId, options.sessionId);
  logger.info(
    {
      sessionId: options.sessionId,
      jobId,
      segmentCount: result.segments?.length,
      wordCount: result.words?.length,
      language: result.language,
    },
    "WhisperX transcription received"
  );
  return result;
}
