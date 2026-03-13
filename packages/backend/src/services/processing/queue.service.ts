import { Job, Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import { config } from "../../config/index.js";
import { logger } from "../../config/logger.js";
import { getDb } from "../../db/connection.js";
import { processConsultationSummary } from "../consultation-summary.service.js";
import { processMetadata } from "./metadata.service.js";
import { processSegmentation } from "./segmentation.service.js";
import { processTranscription } from "./transcription.service.js";

const connection = new Redis(config.redis.url, {
  maxRetriesPerRequest: null,
});

const videoQueue = new Queue("video-processing", { connection });

type JobData = {
  sessionId: string;
  step: "transcribe" | "segment" | "generate-metadata" | "generate-consultation-summary" | "complete";
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

      // For the first step (transcribe), also record started_at on the session
      if (step === "transcribe") {
        db.prepare(
          `
          UPDATE medical_sessions SET status = 'processing', started_at = datetime('now'), updated_at = datetime('now')
          WHERE id = ?
        `
        ).run(sessionId);
      } else {
        db.prepare(
          `
          UPDATE medical_sessions SET status = 'processing', updated_at = datetime('now')
          WHERE id = ?
        `
        ).run(sessionId);
      }

      try {
        // Variables to store cost data for this step
        let inputTokens: number | null = null;
        let outputTokens: number | null = null;
        let audioDurationSeconds: number | null = null;
        let costUsd: number | null = null;

        switch (step) {
          case "transcribe": {
            const result = await processTranscription(sessionId);
            audioDurationSeconds = result.audioDurationSeconds;
            costUsd = result.costUsd;
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
          }

          case "segment": {
            const result = await processSegmentation(sessionId);
            inputTokens = result.inputTokens;
            outputTokens = result.outputTokens;
            costUsd = result.costUsd;
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
          }

          case "generate-metadata": {
            const result = await processMetadata(sessionId);
            inputTokens = result.inputTokens;
            outputTokens = result.outputTokens;
            costUsd = result.costUsd;
            await videoQueue.add(
              "generate-consultation-summary",
              { sessionId, step: "generate-consultation-summary" },
              { jobId: `${sessionId}-consultation-summary` }
            );
            db.prepare(
              `
              INSERT INTO processing_jobs (id, session_id, job_type, status)
              VALUES (?, ?, 'generate-consultation-summary', 'pending')
            `
            ).run(`${sessionId}-consultation-summary`, sessionId);
            break;
          }

          case "generate-consultation-summary": {
            try {
              await processConsultationSummary(sessionId);
            } catch (error) {
              // Non-blocking: log the error but proceed to complete
              logger.error(
                { sessionId, error },
                "Consultation summary generation failed, proceeding to complete"
              );
            }
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
          }

          case "complete": {
            // Calculate total processing cost from all jobs
            const totalCost = db
              .prepare(
                `
                SELECT COALESCE(SUM(cost_usd), 0) as total
                FROM processing_jobs
                WHERE session_id = ? AND cost_usd IS NOT NULL
              `
              )
              .get(sessionId) as { total: number };

            db.prepare(
              `
              UPDATE medical_sessions
              SET status = 'completed', completed_at = datetime('now'), updated_at = datetime('now'), processing_cost_usd = ?
              WHERE id = ?
            `
            ).run(totalCost.total, sessionId);
            break;
          }
        }

        db.prepare(
          `
          UPDATE processing_jobs
          SET status = 'completed', completed_at = datetime('now'),
              input_tokens = ?, output_tokens = ?, audio_duration_seconds = ?, cost_usd = ?
          WHERE session_id = ? AND job_type = ?
        `
        ).run(inputTokens, outputTokens, audioDurationSeconds, costUsd, sessionId, step);

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
