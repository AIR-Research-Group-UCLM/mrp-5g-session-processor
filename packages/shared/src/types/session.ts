import type { SectionType } from "../constants/sections.js";
import type { ClinicalIndicators } from "./clinical-indicators.js";
import type { ProcessingTimeline } from "./processing.js";

export type SessionStatus = "pending" | "processing" | "completed" | "failed";

/** Which transcription backend processed (or will process) a session. */
export type TranscriptionEngine = "openai" | "whisperx";

export interface MedicalSession {
  id: string;
  userId: string;
  title: string | null;
  status: SessionStatus;
  videoS3Key: string | null;
  videoOriginalName: string | null;
  videoDurationSeconds: number | null;
  videoSizeBytes: number | null;
  videoMimeType: string | null;
  language: string | null;
  transcriptionEngine: TranscriptionEngine | null;
  summary: string | null;
  keywords: string[] | null;
  userTags: string[] | null;
  notes: string | null;
  errorMessage: string | null;
  isSimulated: boolean;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  processingCostUsd: number | null;
}

export interface TranscriptSection {
  id: string;
  sessionId: string;
  sectionType: SectionType;
  sectionOrder: number;
  speaker: string | null;
  content: string;
  startTimeSeconds: number | null;
  endTimeSeconds: number | null;
  createdAt: string;
}

export interface SectionSummary {
  id: string;
  sessionId: string;
  sectionType: SectionType;
  summary: string;
  createdAt: string;
}

export interface SessionWithTranscript extends MedicalSession {
  transcript: TranscriptSection[];
  sectionSummaries: SectionSummary[];
  clinicalIndicators: ClinicalIndicators | null;
  processingTimeline: ProcessingTimeline | null;
  simulationTimeline: SimulationTimeline | null;
}

export interface SimulationTimeline {
  conversationDurationMs: number | null;
  audioDurationMs: number | null;
  concatenationDurationMs: number | null;
  totalDurationMs: number | null;
  conversationInputTokens: number | null;
  conversationOutputTokens: number | null;
  conversationCostUsd: number | null;
  elevenlabsCharacters: number | null;
  elevenlabsCostUsd: number | null;
  totalCostUsd: number | null;
}

export interface SessionListItem
  extends Pick<
    MedicalSession,
    | "id"
    | "title"
    | "status"
    | "summary"
    | "keywords"
    | "userTags"
    | "videoDurationSeconds"
    | "language"
    | "transcriptionEngine"
    | "isSimulated"
    | "createdAt"
    | "startedAt"
    | "completedAt"
    | "processingCostUsd"
  > {
  processingDurationMs: number | null;
  // Simulation data (only for simulated sessions)
  simulationDurationMs: number | null;
  simulationCostUsd: number | null;
  // Totals (processing + simulation if applicable)
  totalDurationMs: number | null;
  totalCostUsd: number | null;
  // Assignment data
  isOwner: boolean;
  isAssigned: boolean;
  canWrite: boolean; // true if owner OR (assignment.canWrite=true AND role != readonly)
}

export interface CreateSessionInput {
  title?: string;
  userTags?: string[];
  notes?: string;
  /** Transcription engine to use; falls back to the server default when omitted. */
  transcriptionEngine?: TranscriptionEngine;
}

export interface UpdateSessionInput {
  title?: string;
  userTags?: string[];
  notes?: string;
}
