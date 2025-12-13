import { Job, Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import { config } from "../../config/index.js";
import { logger } from "../../config/logger.js";
import { getDb } from "../../db/connection.js";
import { processMetadata } from "./metadata.service.js";
import { processSegmentation } from "./segmentation.service.js";
import { processTranscription } from "./transcription.service.js";

const connection = new Redis(config.redis.url, {
  maxRetriesPerRequest: null,
});

const videoQueue = new Queue("video-processing", { connection });

type JobData = {
  sessionId: string;
  step: "transcribe" | "segment" | "generate-metadata" | "complete";
};

async function enqueueProcessing(sessionId: string): Promise<void> {
  await videoQueue.add(
    "transcribe",
    { sessionId, step: "transcribe" },
    { jobId: `${sessionId}-transcribe` }
  );

  const db = getDb();
  db.prepare(
    `
    INSERT INTO processing_jobs (id, session_id, job_type, status)
    VALUES (?, ?, 'transcribe', 'pending')
  `
  ).run(`${sessionId}-transcribe`, sessionId);

  logger.info({ sessionId }, "Processing job enqueued");
}

async function startWorker(): Promise<void> {
  const worker = new Worker<JobData>(
    "video-processing",
    async (job: Job<JobData>) => {
      const { sessionId, step } = job.data;
      const db = getDb();

      logger.info({ sessionId, step }, "Processing step started");

      db.prepare(
        `
        UPDATE processing_jobs SET status = 'processing', started_at = datetime('now')
        WHERE session_id = ? AND job_type = ?
      `
      ).run(sessionId, step);

      db.prepare(
        `
        UPDATE medical_sessions SET status = 'processing', updated_at = datetime('now')
        WHERE id = ?
      `
      ).run(sessionId);

      try {
        switch (step) {
          case "transcribe":
            await processTranscription(sessionId);
            await videoQueue.add(
              "segment",
              { sessionId, step: "segment" },
              { jobId: `${sessionId}-segment` }
            );
            db.prepare(
              `
              INSERT INTO processing_jobs (id, session_id, job_type, status)
              VALUES (?, ?, 'segment', 'pending')
            `
            ).run(`${sessionId}-segment`, sessionId);
            break;

          case "segment":
            await processSegmentation(sessionId);
            await videoQueue.add(
              "generate-metadata",
              { sessionId, step: "generate-metadata" },
              { jobId: `${sessionId}-metadata` }
            );
            db.prepare(
              `
              INSERT INTO processing_jobs (id, session_id, job_type, status)
              VALUES (?, ?, 'generate-metadata', 'pending')
            `
            ).run(`${sessionId}-metadata`, sessionId);
            break;

          case "generate-metadata":
            await processMetadata(sessionId);
            await videoQueue.add(
              "complete",
              { sessionId, step: "complete" },
              { jobId: `${sessionId}-complete` }
            );
            db.prepare(
              `
              INSERT INTO processing_jobs (id, session_id, job_type, status)
              VALUES (?, ?, 'complete', 'pending')
            `
            ).run(`${sessionId}-complete`, sessionId);
            break;

          case "complete":
            db.prepare(
              `
              UPDATE medical_sessions
              SET status = 'completed', completed_at = datetime('now'), updated_at = datetime('now')
              WHERE id = ?
            `
            ).run(sessionId);
            break;
        }

        db.prepare(
          `
          UPDATE processing_jobs SET status = 'completed', completed_at = datetime('now')
          WHERE session_id = ? AND job_type = ?
        `
        ).run(sessionId, step);

        logger.info({ sessionId, step }, "Processing step completed");
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";

        db.prepare(
          `
          UPDATE processing_jobs SET status = 'failed', error_message = ?
          WHERE session_id = ? AND job_type = ?
        `
        ).run(errorMessage, sessionId, step);

        db.prepare(
          `
          UPDATE medical_sessions SET status = 'failed', error_message = ?, updated_at = datetime('now')
          WHERE id = ?
        `
        ).run(errorMessage, sessionId);

        logger.error({ sessionId, step, error }, "Processing step failed");
        throw error;
      }
    },
    {
      connection,
      concurrency: 2,
    }
  );

  worker.on("failed", (job, error) => {
    logger.error({ jobId: job?.id, error }, "Job failed");
  });

  logger.info("Processing worker started");
}

export const queueService = {
  enqueueProcessing,
  startWorker,
};
