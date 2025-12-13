import type { SectionType } from "../constants/sections.js";

export type SessionStatus = "pending" | "processing" | "completed" | "failed";

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
  summary: string | null;
  keywords: string[] | null;
  userTags: string[] | null;
  notes: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
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
    | "createdAt"
    | "completedAt"
  > {}

export interface CreateSessionInput {
  title?: string;
  userTags?: string[];
  notes?: string;
}

export interface UpdateSessionInput {
  title?: string;
  userTags?: string[];
  notes?: string;
}
