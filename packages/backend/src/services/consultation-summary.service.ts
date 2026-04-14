import { getLanguageName } from "@mrp/shared";
import { v4 as uuidv4 } from "uuid";
import type { StoredConsultationSummary, ConsultationSummaryPublic } from "@mrp/shared";
import { config } from "../config/index.js";
import { getDb } from "../db/connection.js";
import { logger } from "../config/logger.js";
import { withRetry } from "../utils/retry.js";
import { AppError } from "../middleware/error.middleware.js";
import { callOpenWebUi, validateAndParseSummary, buildSummaryPrompt, generateTooltips } from "../utils/llm.js";
import {
  createShareToken as createShareTokenUtil,
  revokeShareToken as revokeShareTokenUtil,
  getByShareToken as getByShareTokenUtil,
  parseSummaryFields,
} from "../utils/share-token.js";

const TABLE_CFG = {
  table: "consultation_summaries",
  idColumn: "session_id",
  label: "Consultation summary",
} as const;

interface TranscriptSection {
  section_type: string;
  speaker: string | null;
  content: string;
  start_time_seconds: number | null;
  end_time_seconds: number | null;
}

interface SessionData {
  language: string | null;
  status: string;
}

interface ConsultationSummaryRow {
  id: string;
  session_id: string;
  what_happened: string;
  diagnosis: string;
  treatment_plan: string;
  follow_up: string;
  warning_signs: string;
  additional_notes: string | null;
  tooltips: string | null;
  share_token: string | null;
  share_expires_at: string | null;
  created_at: string;
  updated_at: string;
}

function rowToStoredSummary(row: ConsultationSummaryRow): StoredConsultationSummary {
  return {
    id: row.id,
    sessionId: row.session_id,
    ...parseSummaryFields(row),
    shareToken: row.share_token,
    shareExpiresAt: row.share_expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function buildUserMessage(sections: TranscriptSection[]): string {
  const parts: string[] = [];

  parts.push("## Consultation Transcript\n");

  for (const section of sections) {
    const speaker = section.speaker ?? "Unknown";
    const sectionType = section.section_type;
    parts.push(`[${sectionType}] ${speaker}: ${section.content}`);
  }

  return parts.join("\n");
}

async function generateSummaryFromTranscript(sessionId: string): Promise<StoredConsultationSummary> {
  const db = getDb();

  const session = db
    .prepare("SELECT language, status FROM medical_sessions WHERE id = ?")
    .get(sessionId) as SessionData | undefined;

  if (!session) {
    throw new AppError(404, "Session not found");
  }

  const sections = db
    .prepare(
      "SELECT section_type, speaker, content, start_time_seconds, end_time_seconds FROM transcript_sections WHERE session_id = ? ORDER BY section_order"
    )
    .all(sessionId) as TranscriptSection[];

  if (sections.length === 0) {
    throw new Error("No transcript sections found for consultation summary generation");
  }

  const languageName = getLanguageName(session.language ?? "es");
  const systemPrompt = buildSummaryPrompt(
    "the raw transcript of a medical consultation (with speaker roles and section types)",
    `Generate ALL text in ${languageName}`,
  );
  const userMessage = buildUserMessage(sections);

  logger.info({ sessionId, model: config.openWebUi.model }, "Generating consultation summary");
  logger.debug({ sessionId, systemPrompt }, "Consultation summary system message");
  logger.debug({ sessionId, userMessage }, "Consultation summary user message");

  const content = await withRetry(
    () => callOpenWebUi(systemPrompt, userMessage),
    {
      operationName: "consultation-summary-generation",
      sessionId,
      timeoutMs: 120_000,
      maxRetries: 2,
    }
  );

  const summary = validateAndParseSummary(content);
  const tooltips = await generateTooltips(summary);
  const id = uuidv4();

  // Upsert: preserve share_token/share_expires_at on regeneration
  db.prepare(
    `INSERT INTO consultation_summaries (id, session_id, what_happened, diagnosis, treatment_plan, follow_up, warning_signs, additional_notes, tooltips)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(session_id) DO UPDATE SET
       what_happened = excluded.what_happened,
       diagnosis = excluded.diagnosis,
       treatment_plan = excluded.treatment_plan,
       follow_up = excluded.follow_up,
       warning_signs = excluded.warning_signs,
       additional_notes = excluded.additional_notes,
       tooltips = excluded.tooltips,
       updated_at = datetime('now')`
  ).run(
    id,
    sessionId,
    summary.whatHappened,
    summary.diagnosis,
    summary.treatmentPlan,
    summary.followUp,
    JSON.stringify(summary.warningSigns),
    summary.additionalNotes,
    tooltips ? JSON.stringify(tooltips) : null,
  );

  logger.info({ sessionId }, "Consultation summary generated successfully");

  const row = db
    .prepare("SELECT * FROM consultation_summaries WHERE session_id = ?")
    .get(sessionId) as ConsultationSummaryRow;

  return rowToStoredSummary(row);
}

export async function generateConsultationSummary(sessionId: string): Promise<StoredConsultationSummary> {
  const db = getDb();
  const session = db
    .prepare("SELECT status FROM medical_sessions WHERE id = ?")
    .get(sessionId) as { status: string } | undefined;

  if (!session) {
    throw new AppError(404, "Session not found");
  }

  if (session.status !== "completed") {
    throw new AppError(400, "Session processing must be completed before generating consultation summary");
  }

  return generateSummaryFromTranscript(sessionId);
}

// TODO: add cost tracking
export async function processConsultationSummary(sessionId: string): Promise<void> {
  await generateSummaryFromTranscript(sessionId);
}

export function getConsultationSummary(sessionId: string): StoredConsultationSummary | null {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM consultation_summaries WHERE session_id = ?")
    .get(sessionId) as ConsultationSummaryRow | undefined;

  if (!row) return null;
  return rowToStoredSummary(row);
}

export function createShareToken(sessionId: string, expiryHours?: number | null): { token: string; expiresAt: string | null } {
  return createShareTokenUtil(TABLE_CFG, sessionId, undefined, expiryHours);
}

export function revokeShareToken(sessionId: string): void {
  revokeShareTokenUtil(TABLE_CFG, sessionId);
}

export function getByShareToken(token: string): ConsultationSummaryPublic | null {
  return getByShareTokenUtil(
    {
      query: `SELECT cs.*, ms.title AS session_title, ms.created_at AS session_date
              FROM consultation_summaries cs
              JOIN medical_sessions ms ON ms.id = cs.session_id
              WHERE cs.share_token = ? AND (cs.share_expires_at IS NULL OR cs.share_expires_at > datetime('now'))`,
      titleColumn: "session_title",
      dateColumn: "session_date",
    },
    token,
  );
}
