export type JobType =
  | "transcribe"
  | "segment"
  | "generate-metadata"
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

export interface ProcessingProgress {
  sessionId: string;
  status: JobStatus;
  currentStep: JobType | null;
  steps: {
    type: JobType;
    status: JobStatus;
    label: string;
  }[];
  errorMessage: string | null;
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
