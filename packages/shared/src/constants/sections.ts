export const SECTION_TYPES = [
  "introduction",
  "symptoms",
  "diagnosis",
  "treatment",
  "closing",
] as const;

export type SectionType = (typeof SECTION_TYPES)[number];

export const SESSION_STATUSES = [
  "pending",
  "processing",
  "completed",
  "failed",
] as const;

export const JOB_TYPES = [
  "transcribe",
  "segment",
  "generate-metadata",
  "complete",
] as const;
