import { Job, Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { v4 as uuidv4 } from "uuid";
import { config } from "../../config/index.js";
import { logger } from "../../config/logger.js";
import { getDb } from "../../db/connection.js";
import { s3Service } from "../s3.service.js";
import { queueService } from "../processing/queue.service.js";
import { generateConversation } from "./conversation.service.js";
import {
  generateSegmentAudio,
  concatenateAudioFiles,
  getAudioDuration,
} from "./audio.service.js";
import { simulatorService } from "./simulator.service.js";
import type { SimulatedTranscript } from "@mrp/shared";

const connection = new Redis(config.redis.url, {
  maxRetriesPerRequest: null,
});

export const simulatorQueue = new Queue("simulator-processing", { connection });

type SimulatorJobData =
  | {
      step: "generate-conversation";
      simulationId: string;
    }
  | {
      step: "generate-audio";
      simulationId: string;
      segmentIndex: number;
      text: string;
      voiceId: string;
    }
  | {
      step: "concatenate-audio";
      simulationId: string;
    };

async function processGenerateConversation(simulationId: string): Promise<void> {
  const simulation = simulatorService.getSimulation(simulationId);
  if (!simulation) {
    throw new Error(`Simulation not found: ${simulationId}`);
  }

  simulatorService.updateSimulationStatus(simulationId, "generating-conversation", {
    currentStep: "generate-conversation",
  });

  // Generate the conversation
  const transcript = await generateConversation(simulation.context, simulation.language);

  // Save transcript to S3
  const transcriptS3Key = `simulations/${simulationId}/transcript.json`;
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "mrp-sim-"));
  const transcriptPath = path.join(tempDir, "transcript.json");

  try {
    await fs.writeFile(transcriptPath, JSON.stringify(transcript, null, 2));
    await s3Service.uploadFile(transcriptS3Key, transcriptPath, "application/json");
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }

  // Update simulation with total segments
  simulatorService.updateSimulationStatus(simulationId, "generating-audio", {
    currentStep: "generate-audio",
    totalSegments: transcript.segments.length,
    completedSegments: 0,
  });

  // Enqueue audio generation jobs for each segment
  for (let i = 0; i < transcript.segments.length; i++) {
    const segment = transcript.segments[i];
    if (!segment) continue;

    // Get the voice ID for this speaker from the simulation's voice selection
    const voiceId = simulation.voices[segment.speaker];

    await simulatorQueue.add(
      "generate-audio",
      {
        step: "generate-audio",
        simulationId,
        segmentIndex: i,
        text: segment.text,
        voiceId,
      },
      {
        jobId: `${simulationId}-audio-${i.toString().padStart(4, "0")}`,
      }
    );
  }

  logger.info(
    { simulationId, segmentCount: transcript.segments.length },
    "Conversation generated, audio jobs enqueued"
  );
}

async function processGenerateAudio(
  simulationId: string,
  segmentIndex: number,
  text: string,
  voiceId: string
): Promise<void> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "mrp-audio-"));

  try {
    // Generate audio for this segment
    const segmentFileName = `segment_${segmentIndex.toString().padStart(4, "0")}.mp3`;
    const localPath = path.join(tempDir, segmentFileName);

    await generateSegmentAudio(text, voiceId, localPath);

    // Upload to S3
    const s3Key = `simulations/${simulationId}/segments/${segmentFileName}`;
    await s3Service.uploadFile(s3Key, localPath, "audio/mpeg");

    // Increment completed count and check if all done
    const completedCount = simulatorService.incrementCompletedSegments(simulationId);
    const simulation = simulatorService.getSimulation(simulationId);

    logger.info(
      { simulationId, segmentIndex, completedCount, total: simulation?.totalSegments },
      "Audio segment generated"
    );

    // If all segments are done, enqueue concatenation
    if (simulation && completedCount >= (simulation.totalSegments ?? 0)) {
      await simulatorQueue.add(
        "concatenate-audio",
        { step: "concatenate-audio", simulationId },
        { jobId: `${simulationId}-concat` }
      );
      logger.info({ simulationId }, "All audio segments complete, concatenation enqueued");
    }
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function processConcatenateAudio(simulationId: string): Promise<void> {
  const simulation = simulatorService.getSimulation(simulationId);
  if (!simulation) {
    throw new Error(`Simulation not found: ${simulationId}`);
  }

  simulatorService.updateSimulationStatus(simulationId, "concatenating-audio", {
    currentStep: "concatenate-audio",
  });

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "mrp-concat-"));

  try {
    // Download all segment files from S3
    const segmentPaths: string[] = [];
    const totalSegments = simulation.totalSegments ?? 0;

    for (let i = 0; i < totalSegments; i++) {
      const segmentFileName = `segment_${i.toString().padStart(4, "0")}.mp3`;
      const s3Key = `simulations/${simulationId}/segments/${segmentFileName}`;
      const localPath = path.join(tempDir, segmentFileName);

      // Download from S3
      const presignedUrl = await s3Service.getPresignedUrl(s3Key);
      const response = await fetch(presignedUrl);
      if (!response.ok) {
        throw new Error(`Failed to download segment ${i}: ${response.statusText}`);
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      await fs.writeFile(localPath, buffer);

      segmentPaths.push(localPath);
    }

    // Concatenate all segments
    const outputPath = path.join(tempDir, "audio.mp3");
    await concatenateAudioFiles(
      segmentPaths,
      outputPath,
      config.simulator.pauseBetweenSegmentsMs,
      tempDir
    );

    // Get duration
    const durationSeconds = await getAudioDuration(outputPath);

    // Create the medical session
    const sessionId = uuidv4();
    const userId = simulation.userId;
    const audioS3Key = s3Service.getVideoKey(userId, sessionId, "audio.mp3");

    // Upload final audio to session directory
    await s3Service.uploadFile(audioS3Key, outputPath, "audio/mpeg");

    // Also save the original transcript JSON to the session directory
    const transcriptS3Key = `simulations/${simulationId}/transcript.json`;
    const transcriptUrl = await s3Service.getPresignedUrl(transcriptS3Key);
    const transcriptResponse = await fetch(transcriptUrl);
    const transcriptData = await transcriptResponse.json() as SimulatedTranscript;

    const sessionTranscriptPath = path.join(tempDir, "simulated_transcript.json");
    await fs.writeFile(sessionTranscriptPath, JSON.stringify(transcriptData, null, 2));
    const sessionTranscriptS3Key = `${userId}/${sessionId}/simulated_transcript.json`;
    await s3Service.uploadFile(sessionTranscriptS3Key, sessionTranscriptPath, "application/json");

    // Get file size
    const audioStats = await fs.stat(outputPath);

    // Create session in database
    const db = getDb();
    db.prepare(
      `
      INSERT INTO medical_sessions (
        id, user_id, title, status, video_s3_key, video_original_name,
        video_size_bytes, video_mime_type, video_duration_seconds,
        language, user_tags, notes, is_simulated
      ) VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `
    ).run(
      sessionId,
      userId,
      simulation.title,
      audioS3Key,
      "audio.mp3",
      audioStats.size,
      "audio/mpeg",
      durationSeconds,
      simulation.language,
      simulation.userTags ? JSON.stringify(simulation.userTags) : null,
      simulation.notes
    );

    // Update simulation with session ID
    simulatorService.updateSimulationStatus(simulationId, "creating-session", {
      currentStep: null,
      sessionId,
    });

    // Enqueue session processing
    await queueService.enqueueProcessing(sessionId);

    // Mark simulation as completed
    simulatorService.updateSimulationStatus(simulationId, "completed", {
      currentStep: null,
    });

    logger.info(
      { simulationId, sessionId, durationSeconds, audioSizeBytes: audioStats.size },
      "Simulation completed, session created and processing enqueued"
    );
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function processSimulatorJob(job: Job<SimulatorJobData>): Promise<void> {
  const { step } = job.data;

  logger.info({ jobId: job.id, step }, "Simulator job started");

  try {
    switch (step) {
      case "generate-conversation":
        await processGenerateConversation(job.data.simulationId);
        break;

      case "generate-audio":
        await processGenerateAudio(
          job.data.simulationId,
          job.data.segmentIndex,
          job.data.text,
          job.data.voiceId
        );
        break;

      case "concatenate-audio":
        await processConcatenateAudio(job.data.simulationId);
        break;
    }

    logger.info({ jobId: job.id, step }, "Simulator job completed");
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";

    // Only update simulation status to failed for non-audio jobs
    // Audio jobs failing individually shouldn't fail the whole simulation
    if (step !== "generate-audio") {
      const simulationId =
        step === "generate-conversation"
          ? job.data.simulationId
          : job.data.simulationId;

      simulatorService.updateSimulationStatus(simulationId, "failed", {
        errorMessage,
      });
    }

    logger.error({ jobId: job.id, step, error }, "Simulator job failed");
    throw error;
  }
}

export async function startSimulatorWorker(): Promise<void> {
  const worker = new Worker<SimulatorJobData>(
    "simulator-processing",
    processSimulatorJob,
    {
      connection,
      concurrency: config.simulator.audioConcurrency,
    }
  );

  worker.on("failed", (job, error) => {
    logger.error({ jobId: job?.id, error: error.message }, "Simulator job failed");
  });

  logger.info(
    { concurrency: config.simulator.audioConcurrency },
    "Simulator worker started"
  );
}

export const simulatorQueueService = {
  startWorker: startSimulatorWorker,
};
