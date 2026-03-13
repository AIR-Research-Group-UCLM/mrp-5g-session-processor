import crypto from "node:crypto";
import { getLanguageName } from "@mrp/shared";
import { v4 as uuidv4 } from "uuid";
import type { StoredConsultationSummary, ConsultationSummaryPublic } from "@mrp/shared";
import { z } from "zod";
import { config } from "../config/index.js";
import { getDb } from "../db/connection.js";
import { logger } from "../config/logger.js";
import { withRetry } from "../utils/retry.js";
import { AppError } from "../middleware/error.middleware.js";

const consultationSummarySchema = z.object({
  whatHappened: z.string(),
  diagnosis: z.string(),
  treatmentPlan: z.string(),
  followUp: z.string(),
  warningSigns: z.union([
    z.array(z.string()),
    z.string().transform((s) => [s]),
  ]),
  additionalNotes: z.string().nullable(),
});

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
  share_token: string | null;
  share_expires_at: string | null;
  created_at: string;
  updated_at: string;
}

interface PublicSummaryRow extends ConsultationSummaryRow {
  session_title: string | null;
  session_date: string;
}

function rowToStoredSummary(row: ConsultationSummaryRow): StoredConsultationSummary {
  return {
    id: row.id,
    sessionId: row.session_id,
    whatHappened: row.what_happened,
    diagnosis: row.diagnosis,
    treatmentPlan: row.treatment_plan,
    followUp: row.follow_up,
    warningSigns: JSON.parse(row.warning_signs),
    additionalNotes: row.additional_notes,
    shareToken: row.share_token,
    shareExpiresAt: row.share_expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function callOpenWebUi(
  systemPrompt: string,
  userMessage: string,
): Promise<string> {
  if (!config.openWebUi.baseUrl || !config.openWebUi.apiKey) {
    throw new AppError(503, "Consultation summary feature is not configured");
  }

  const url = `${config.openWebUi.baseUrl}/chat/completions`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.openWebUi.apiKey}`,
    },
    body: JSON.stringify({
      model: config.openWebUi.model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      temperature: 0.3,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Open WebUI returned ${response.status}: ${text}`);
  }

  const data = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = data?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("No response content from Open WebUI");
  }
  return content;
}

function buildPrompt(languageName: string): string {
  return `You are a medical communication specialist. Given the raw transcript of a medical consultation (with speaker roles and section types), generate a clear, patient-friendly explanation of the consultation.

Write as if you are explaining directly to the patient what happened during their visit. Use simple, non-technical language that a patient without medical training can understand.

Respond in JSON with the following format:
{
  "whatHappened": "A clear summary of what took place during the consultation",
  "diagnosis": "What the doctor found or suspects, explained simply",
  "treatmentPlan": "What the patient needs to do (medications, lifestyle changes, etc.)",
  "followUp": "Next steps, when to come back, what appointments to schedule",
  "warningSigns": ["Sign 1 to watch for", "Sign 2 to watch for"],
  "additionalNotes": "Any other important information, or null if none"
}

IMPORTANT RULES:
- Use simple, everyday language — avoid medical jargon
- Be reassuring but honest
- If warning signs were mentioned, list them clearly
- If there is no information for a field, provide a reasonable "No specific information was discussed" message
- additionalNotes should be null if there is nothing extra to add
- CRITICAL: Generate ALL text in ${languageName}`;
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

function extractJson(text: string): unknown {
  // Try direct parse first
  try {
    return JSON.parse(text);
  } catch {
    // Try to extract JSON from markdown code block or surrounding text
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/) ?? text.match(/(\{[\s\S]*\})/);
    if (jsonMatch?.[1]) {
      return JSON.parse(jsonMatch[1].trim());
    }
    throw new Error("Failed to extract JSON from response");
  }
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
  const systemPrompt = buildPrompt(languageName);
  const userMessage = buildUserMessage(sections);

  logger.info({ sessionId, model: config.openWebUi.model }, "Generating consultation summary");

  const content = await withRetry(
    () => callOpenWebUi(systemPrompt, userMessage),
    {
      operationName: "consultation-summary-generation",
      sessionId,
      timeoutMs: 120_000,
      maxRetries: 2,
    }
  );

  const parsed = extractJson(content);
  const validationResult = consultationSummarySchema.safeParse(parsed);

  if (!validationResult.success) {
    logger.error(
      { errors: validationResult.error.issues, content },
      "Invalid consultation summary response structure"
    );
    throw new Error("Invalid consultation summary response structure from LLM");
  }

  const summary = validationResult.data;
  const id = uuidv4();

  // Upsert: preserve share_token/share_expires_at on regeneration
  db.prepare(
    `INSERT INTO consultation_summaries (id, session_id, what_happened, diagnosis, treatment_plan, follow_up, warning_signs, additional_notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(session_id) DO UPDATE SET
       what_happened = excluded.what_happened,
       diagnosis = excluded.diagnosis,
       treatment_plan = excluded.treatment_plan,
       follow_up = excluded.follow_up,
       warning_signs = excluded.warning_signs,
       additional_notes = excluded.additional_notes,
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

export function createShareToken(sessionId: string): { token: string; expiresAt: string } {
  const db = getDb();

  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(
    Date.now() + config.consultationSummary.shareExpiryHours * 60 * 60 * 1000
  ).toISOString();

  const result = db.prepare(
    "UPDATE consultation_summaries SET share_token = ?, share_expires_at = ?, updated_at = datetime('now') WHERE session_id = ?"
  ).run(token, expiresAt, sessionId);

  if (result.changes === 0) {
    throw new AppError(404, "Consultation summary not found. Generate one first.");
  }

  logger.info({ sessionId }, "Share token created for consultation summary");

  return { token, expiresAt };
}

export function revokeShareToken(sessionId: string): void {
  const db = getDb();

  db.prepare(
    "UPDATE consultation_summaries SET share_token = NULL, share_expires_at = NULL, updated_at = datetime('now') WHERE session_id = ?"
  ).run(sessionId);

  logger.info({ sessionId }, "Share token revoked for consultation summary");
}

export function getByShareToken(token: string): ConsultationSummaryPublic | null {
  const db = getDb();

  const row = db
    .prepare(
      `SELECT cs.*, ms.title AS session_title, ms.created_at AS session_date
       FROM consultation_summaries cs
       JOIN medical_sessions ms ON ms.id = cs.session_id
       WHERE cs.share_token = ? AND cs.share_expires_at > datetime('now')`
    )
    .get(token) as PublicSummaryRow | undefined;

  if (!row) return null;

  return {
    summary: {
      whatHappened: row.what_happened,
      diagnosis: row.diagnosis,
      treatmentPlan: row.treatment_plan,
      followUp: row.follow_up,
      warningSigns: JSON.parse(row.warning_signs),
      additionalNotes: row.additional_notes,
    },
    sessionTitle: row.session_title,
    sessionDate: row.session_date,
    expiresAt: row.share_expires_at!,
  };
}
