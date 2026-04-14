import { v4 as uuidv4 } from "uuid";
import type {
  StoredReportSummary,
  ReportSummaryListItem,
  ConsultationSummaryPublic,
} from "@mrp/shared";
import { config } from "../config/index.js";
import { getDb } from "../db/connection.js";
import { logger } from "../config/logger.js";
import { withRetry } from "../utils/retry.js";
import { callOpenWebUi, validateAndParseSummary, buildSummaryPrompt, generateTooltips } from "../utils/llm.js";
import {
  createShareToken as createShareTokenUtil,
  revokeShareToken as revokeShareTokenUtil,
  getByShareToken as getByShareTokenUtil,
  parseSummaryFields,
} from "../utils/share-token.js";

const TABLE_CFG = {
  table: "report_summaries",
  idColumn: "id",
  ownerColumn: "user_id",
  label: "Report summary",
} as const;

interface ReportSummaryRow {
  id: string;
  user_id: string;
  title: string | null;
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

function rowToStoredSummary(row: ReportSummaryRow): StoredReportSummary {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    ...parseSummaryFields(row),
    shareToken: row.share_token,
    shareExpiresAt: row.share_expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToListItem(row: ReportSummaryRow): ReportSummaryListItem {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    shareToken: row.share_token,
    shareExpiresAt: row.share_expires_at,
  };
}

export async function generateReportSummary(
  userId: string,
  reportText: string,
  title: string | null,
): Promise<StoredReportSummary> {
  const systemPrompt = buildSummaryPrompt(
    "a doctor's medical report about a patient consultation",
    "Generate ALL text in the same language as the doctor's report",
  );
  const userMessage = `## Doctor's Report\n\n${reportText}`;

  logger.info({ userId, model: config.openWebUi.model }, "Generating report summary");

  const content = await withRetry(
    () => callOpenWebUi(systemPrompt, userMessage),
    {
      operationName: "report-summary-generation",
      timeoutMs: 120_000,
      maxRetries: 2,
    }
  );

  const summary = validateAndParseSummary(content);
  const tooltips = await generateTooltips(summary);
  const id = uuidv4();
  const db = getDb();

  db.prepare(
    `INSERT INTO report_summaries (id, user_id, title, what_happened, diagnosis, treatment_plan, follow_up, warning_signs, additional_notes, tooltips)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    userId,
    title,
    summary.whatHappened,
    summary.diagnosis,
    summary.treatmentPlan,
    summary.followUp,
    JSON.stringify(summary.warningSigns),
    summary.additionalNotes,
    tooltips ? JSON.stringify(tooltips) : null,
  );

  logger.info({ userId, summaryId: id }, "Report summary generated successfully");

  const row = db
    .prepare("SELECT * FROM report_summaries WHERE id = ?")
    .get(id) as ReportSummaryRow;

  return rowToStoredSummary(row);
}

export function listReportSummaries(
  userId: string,
  page: number,
  pageSize: number,
): { summaries: ReportSummaryListItem[]; total: number } {
  const db = getDb();
  const offset = (page - 1) * pageSize;

  const rows = db
    .prepare(
      "SELECT * FROM report_summaries WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?"
    )
    .all(userId, pageSize, offset) as ReportSummaryRow[];

  const total = (
    db
      .prepare("SELECT COUNT(*) AS count FROM report_summaries WHERE user_id = ?")
      .get(userId) as { count: number }
  ).count;

  return {
    summaries: rows.map(rowToListItem),
    total,
  };
}

export function getReportSummary(id: string, userId: string): StoredReportSummary | null {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM report_summaries WHERE id = ? AND user_id = ?")
    .get(id, userId) as ReportSummaryRow | undefined;

  if (!row) return null;
  return rowToStoredSummary(row);
}

export function deleteReportSummary(id: string, userId: string): boolean {
  const db = getDb();
  const result = db
    .prepare("DELETE FROM report_summaries WHERE id = ? AND user_id = ?")
    .run(id, userId);

  if (result.changes === 0) return false;

  logger.info({ userId, summaryId: id }, "Report summary deleted");
  return true;
}

export function createShareToken(summaryId: string, userId: string, expiryHours?: number | null): { token: string; expiresAt: string | null } {
  return createShareTokenUtil(TABLE_CFG, summaryId, userId, expiryHours);
}

export function revokeShareToken(summaryId: string, userId: string): void {
  revokeShareTokenUtil(TABLE_CFG, summaryId, userId);
}

export function getByShareToken(token: string): ConsultationSummaryPublic | null {
  return getByShareTokenUtil(
    {
      query: `SELECT * FROM report_summaries
              WHERE share_token = ? AND (share_expires_at IS NULL OR share_expires_at > datetime('now'))`,
      titleColumn: "title",
      dateColumn: "created_at",
    },
    token,
  );
}
