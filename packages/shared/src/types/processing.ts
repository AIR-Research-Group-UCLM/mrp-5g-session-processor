export type JobType =
  | "transcribe"
  | "segment"
  | "generate-metadata"
  | "generate-consultation-summary"
  | "complete";

export type JobStatus = "pending" | "processing" | "completed" | "failed";

export interface ProcessingJob {
  id: string;
  sessionId: string;
  jobType: JobType;
  status: JobStatus;
  priority: number;
  attempts: number;
  maxAttempts: number;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface ProcessingStepTiming {
  type: JobType;
  status: JobStatus;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  audioDurationSeconds: number | null;
  costUsd: number | null;
}

export interface ProcessingTimeline {
  totalDurationMs: number | null;
  totalCostUsd: number | null;
  steps: ProcessingStepTiming[];
}

export interface ProcessingProgress {
  sessionId: string;
  status: JobStatus;
  currentStep: JobType | null;
  steps: ProcessingStepTiming[];
  errorMessage: string | null;
  totalDurationMs: number | null;
  totalCostUsd: number | null;
  startedAt: string | null;
  completedAt: string | null;
}

export interface TranscriptSegment {
  speaker: string;
  text: string;
  startTime: number;
  endTime: number;
}

export interface DiarizedTranscript {
  segments: TranscriptSegment[];
  fullText: string;
  duration: number;
}
