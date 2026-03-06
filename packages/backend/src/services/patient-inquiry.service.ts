import crypto from "node:crypto";
import { getLanguageName } from "@mrp/shared";
import { v4 as uuidv4 } from "uuid";
import type { StoredPatientInquiry, PatientInquiryPublic } from "@mrp/shared";
import OpenAI from "openai";
import { z } from "zod";
import { config } from "../config/index.js";
import { getDb } from "../db/connection.js";
import { logger } from "../config/logger.js";
import { withRetry } from "../utils/retry.js";
import { AppError } from "../middleware/error.middleware.js";

const patientInquirySchema = z.object({
  whatHappened: z.string(),
  diagnosis: z.string(),
  treatmentPlan: z.string(),
  followUp: z.string(),
  warningSigns: z.array(z.string()),
  additionalNotes: z.string().nullable(),
});

interface SessionData {
  summary: string | null;
  language: string | null;
  status: string;
}

interface SectionSummary {
  section_type: string;
  summary: string;
}

interface ClinicalIndicatorsRow {
  urgency_level: string | null;
  reason_for_visit: string | null;
  main_clinical_problem: string | null;
  diagnostic_hypothesis: string | null;
  treatment_plan: string | null;
  warning_signs: string | null;
  follow_up_plan: string | null;
  patient_education: string | null;
}

interface PatientInquiryRow {
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

interface PublicInquiryRow extends PatientInquiryRow {
  session_title: string | null;
  session_date: string;
}

function rowToStoredInquiry(row: PatientInquiryRow): StoredPatientInquiry {
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

function getOpenWebUiClient(): OpenAI {
  if (!config.openWebUi.baseUrl || !config.openWebUi.apiKey) {
    throw new AppError(503, "Patient inquiry feature is not configured");
  }

  return new OpenAI({
    baseURL: config.openWebUi.baseUrl + "/api",
    apiKey: config.openWebUi.apiKey,
  });
}

function buildPrompt(languageName: string): string {
  return `You are a medical communication specialist. Given a medical session summary, section summaries, and clinical indicators, generate a clear, patient-friendly explanation of the consultation.

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

function buildUserMessage(
  session: SessionData,
  sectionSummaries: SectionSummary[],
  clinicalIndicators: ClinicalIndicatorsRow | null
): string {
  const parts: string[] = [];

  if (session.summary) {
    parts.push(`## Session Summary\n${session.summary}`);
  }

  if (sectionSummaries.length > 0) {
    const summariesText = sectionSummaries
      .map((s) => `- ${s.section_type}: ${s.summary}`)
      .join("\n");
    parts.push(`## Section Summaries\n${summariesText}`);
  }

  if (clinicalIndicators) {
    const ciParts: string[] = [];
    if (clinicalIndicators.urgency_level) ciParts.push(`Urgency: ${clinicalIndicators.urgency_level}`);
    if (clinicalIndicators.reason_for_visit) ciParts.push(`Reason for visit: ${clinicalIndicators.reason_for_visit}`);
    if (clinicalIndicators.main_clinical_problem) ciParts.push(`Main problem: ${clinicalIndicators.main_clinical_problem}`);
    if (clinicalIndicators.diagnostic_hypothesis) ciParts.push(`Diagnostic hypothesis: ${clinicalIndicators.diagnostic_hypothesis}`);
    if (clinicalIndicators.treatment_plan) ciParts.push(`Treatment plan: ${clinicalIndicators.treatment_plan}`);
    if (clinicalIndicators.warning_signs) ciParts.push(`Warning signs: ${clinicalIndicators.warning_signs}`);
    if (clinicalIndicators.follow_up_plan) ciParts.push(`Follow-up plan: ${clinicalIndicators.follow_up_plan}`);
    if (clinicalIndicators.patient_education) ciParts.push(`Patient education: ${clinicalIndicators.patient_education}`);

    if (ciParts.length > 0) {
      parts.push(`## Clinical Indicators\n${ciParts.join("\n")}`);
    }
  }

  return parts.join("\n\n");
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

export async function generatePatientInquiry(sessionId: string): Promise<StoredPatientInquiry> {
  const client = getOpenWebUiClient();
  const db = getDb();

  const session = db
    .prepare("SELECT summary, language, status FROM medical_sessions WHERE id = ?")
    .get(sessionId) as SessionData | undefined;

  if (!session) {
    throw new AppError(404, "Session not found");
  }

  if (session.status !== "completed") {
    throw new AppError(400, "Session processing must be completed before generating patient inquiry");
  }

  const sectionSummaries = db
    .prepare("SELECT section_type, summary FROM section_summaries WHERE session_id = ?")
    .all(sessionId) as SectionSummary[];

  const clinicalIndicators = db
    .prepare(
      `SELECT urgency_level, reason_for_visit, main_clinical_problem,
              diagnostic_hypothesis, treatment_plan, warning_signs,
              follow_up_plan, patient_education
       FROM clinical_indicators WHERE session_id = ?`
    )
    .get(sessionId) as ClinicalIndicatorsRow | null;

  const languageName = getLanguageName(session.language ?? "es");
  const systemPrompt = buildPrompt(languageName);
  const userMessage = buildUserMessage(session, sectionSummaries, clinicalIndicators);

  logger.info({ sessionId, model: config.openWebUi.model }, "Generating patient inquiry");

  const completion = await withRetry(
    async () => {
      try {
        return await client.chat.completions.create({
          model: config.openWebUi.model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userMessage },
          ],
          response_format: { type: "json_object" },
          temperature: 0.3,
        });
      } catch (error) {
        // Fallback: if the model doesn't support response_format, retry without it
        if (error instanceof Error && error.message.includes("response_format")) {
          logger.warn({ sessionId }, "Model does not support response_format, retrying without it");
          return client.chat.completions.create({
            model: config.openWebUi.model,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userMessage },
            ],
            temperature: 0.3,
          });
        }
        throw error;
      }
    },
    {
      operationName: "patient-inquiry-generation",
      sessionId,
      timeoutMs: 120_000,
      maxRetries: 2,
    }
  );

  const content = completion.choices[0]?.message?.content;
  if (!content) {
    throw new Error("No response from LLM");
  }

  const parsed = extractJson(content);
  const validationResult = patientInquirySchema.safeParse(parsed);

  if (!validationResult.success) {
    logger.error(
      { errors: validationResult.error.issues, content },
      "Invalid patient inquiry response structure"
    );
    throw new Error("Invalid patient inquiry response structure from LLM");
  }

  const inquiry = validationResult.data;
  const id = uuidv4();

  // Upsert: preserve share_token/share_expires_at on regeneration
  db.prepare(
    `INSERT INTO patient_inquiries (id, session_id, what_happened, diagnosis, treatment_plan, follow_up, warning_signs, additional_notes)
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
    inquiry.whatHappened,
    inquiry.diagnosis,
    inquiry.treatmentPlan,
    inquiry.followUp,
    JSON.stringify(inquiry.warningSigns),
    inquiry.additionalNotes,
  );

  logger.info({ sessionId }, "Patient inquiry generated successfully");

  const row = db
    .prepare("SELECT * FROM patient_inquiries WHERE session_id = ?")
    .get(sessionId) as PatientInquiryRow;

  return rowToStoredInquiry(row);
}

export function getPatientInquiry(sessionId: string): StoredPatientInquiry | null {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM patient_inquiries WHERE session_id = ?")
    .get(sessionId) as PatientInquiryRow | undefined;

  if (!row) return null;
  return rowToStoredInquiry(row);
}

export function createShareToken(sessionId: string): { token: string; expiresAt: string } {
  const db = getDb();

  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(
    Date.now() + config.patientInquiry.shareExpiryHours * 60 * 60 * 1000
  ).toISOString();

  const result = db.prepare(
    "UPDATE patient_inquiries SET share_token = ?, share_expires_at = ?, updated_at = datetime('now') WHERE session_id = ?"
  ).run(token, expiresAt, sessionId);

  if (result.changes === 0) {
    throw new AppError(404, "Patient inquiry not found. Generate one first.");
  }

  logger.info({ sessionId }, "Share token created for patient inquiry");

  return { token, expiresAt };
}

export function revokeShareToken(sessionId: string): void {
  const db = getDb();

  db.prepare(
    "UPDATE patient_inquiries SET share_token = NULL, share_expires_at = NULL, updated_at = datetime('now') WHERE session_id = ?"
  ).run(sessionId);

  logger.info({ sessionId }, "Share token revoked for patient inquiry");
}

export function getByShareToken(token: string): PatientInquiryPublic | null {
  const db = getDb();

  const row = db
    .prepare(
      `SELECT pi.*, ms.title AS session_title, ms.created_at AS session_date
       FROM patient_inquiries pi
       JOIN medical_sessions ms ON ms.id = pi.session_id
       WHERE pi.share_token = ? AND pi.share_expires_at > datetime('now')`
    )
    .get(token) as PublicInquiryRow | undefined;

  if (!row) return null;

  return {
    inquiry: {
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
