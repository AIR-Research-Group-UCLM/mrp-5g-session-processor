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

interface ReportSummaryRowWithAccess extends ReportSummaryRow {
  is_owner: number;
  assignment_can_write: number | null;
}

function computeCanWrite(
  row: ReportSummaryRowWithAccess,
  userRole: string
): boolean {
  if (row.is_owner === 1) return true;
  if (userRole === "readonly") return false;
  return row.assignment_can_write === 1;
}

function rowToStoredSummary(
  row: ReportSummaryRowWithAccess,
  userRole: string
): StoredReportSummary {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    ...parseSummaryFields(row),
    shareToken: row.share_token,
    shareExpiresAt: row.share_expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    isOwner: row.is_owner === 1,
    canWrite: computeCanWrite(row, userRole),
  };
}

function rowToListItem(
  row: ReportSummaryRowWithAccess,
  userRole: string
): ReportSummaryListItem {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    shareToken: row.share_token,
    shareExpiresAt: row.share_expires_at,
    isOwner: row.is_owner === 1,
    canWrite: computeCanWrite(row, userRole),
  };
}

function getUserRole(userId: string): string {
  const db = getDb();
  const user = db
    .prepare("SELECT role FROM users WHERE id = ?")
    .get(userId) as { role: string } | undefined;
  return user?.role ?? "readonly";
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
    .prepare(
      `SELECT rs.*,
              1 AS is_owner,
              NULL AS assignment_can_write
       FROM report_summaries rs
       WHERE rs.id = ?`
    )
    .get(id) as ReportSummaryRowWithAccess;

  return rowToStoredSummary(row, getUserRole(userId));
}

const LIST_SELECT_SQL = `
  SELECT rs.*,
         CASE WHEN rs.user_id = ? THEN 1 ELSE 0 END AS is_owner,
         rsa.can_write AS assignment_can_write
  FROM report_summaries rs
  LEFT JOIN report_summary_assignments rsa
    ON rsa.report_summary_id = rs.id AND rsa.user_id = ?
  WHERE rs.user_id = ? OR rsa.user_id = ?
  ORDER BY rs.created_at DESC
  LIMIT ? OFFSET ?
`;

const LIST_COUNT_SQL = `
  SELECT COUNT(*) AS count
  FROM report_summaries rs
  LEFT JOIN report_summary_assignments rsa
    ON rsa.report_summary_id = rs.id AND rsa.user_id = ?
  WHERE rs.user_id = ? OR rsa.user_id = ?
`;

export function listReportSummaries(
  userId: string,
  page: number,
  pageSize: number,
): { summaries: ReportSummaryListItem[]; total: number } {
  const db = getDb();
  const offset = (page - 1) * pageSize;
  const userRole = getUserRole(userId);

  const rows = db
    .prepare(LIST_SELECT_SQL)
    .all(userId, userId, userId, userId, pageSize, offset) as ReportSummaryRowWithAccess[];

  const total = (
    db
      .prepare(LIST_COUNT_SQL)
      .get(userId, userId, userId) as { count: number }
  ).count;

  return {
    summaries: rows.map((r) => rowToListItem(r, userRole)),
    total,
  };
}

export function getReportSummary(
  id: string,
  userId: string
): StoredReportSummary | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT rs.*,
              CASE WHEN rs.user_id = ? THEN 1 ELSE 0 END AS is_owner,
              rsa.can_write AS assignment_can_write
       FROM report_summaries rs
       LEFT JOIN report_summary_assignments rsa
         ON rsa.report_summary_id = rs.id AND rsa.user_id = ?
       WHERE rs.id = ? AND (rs.user_id = ? OR rsa.user_id = ?)`
    )
    .get(userId, userId, id, userId, userId) as
    | ReportSummaryRowWithAccess
    | undefined;

  if (!row) return null;
  return rowToStoredSummary(row, getUserRole(userId));
}

export function deleteReportSummary(id: string, userId: string): boolean {
  // Owner-only delete, matching session delete semantics.
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
