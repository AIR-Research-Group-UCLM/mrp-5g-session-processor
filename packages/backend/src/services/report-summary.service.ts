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
  parseValidatorState,
  parseConfirmationState,
} from "../utils/share-token.js";
import { AppError } from "../middleware/error.middleware.js";
import { runSafetyValidation } from "./safety-validator.service.js";

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
  validator_model: string | null;
  validator_status: string | null;
  validator_report: string | null;
  validator_run_at: string | null;
  confirmed_at: string | null;
  confirmed_by: string | null;
  share_token: string | null;
  share_expires_at: string | null;
  created_at: string;
  updated_at: string;
}

interface ReportSummaryRowWithAccess extends ReportSummaryRow {
  is_owner: number;
  assignment_can_write: number | null;
  viewer_role: string | null;
}

function computeCanWrite(row: ReportSummaryRowWithAccess): boolean {
  if (row.is_owner === 1) return true;
  if (row.viewer_role === "readonly") return false;
  return row.assignment_can_write === 1;
}

function rowToStoredSummary(
  row: ReportSummaryRowWithAccess
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
    canWrite: computeCanWrite(row),
    validator: parseValidatorState(row),
    confirmation: parseConfirmationState(row),
  };
}

function rowToListItem(
  row: ReportSummaryRowWithAccess
): ReportSummaryListItem {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    shareToken: row.share_token,
    shareExpiresAt: row.share_expires_at,
    isOwner: row.is_owner === 1,
    canWrite: computeCanWrite(row),
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
  const summaryWithTooltips = { ...summary, warningSigns: summary.warningSigns, tooltips: tooltips ?? null };
  const validation = await runSafetyValidation(summaryWithTooltips, reportText);
  const id = uuidv4();
  const db = getDb();

  db.prepare(
    `INSERT INTO report_summaries (
       id, user_id, title, source_text, what_happened, diagnosis, treatment_plan, follow_up, warning_signs, additional_notes, tooltips,
       validator_model, validator_status, validator_report, validator_run_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    userId,
    title,
    reportText,
    summary.whatHappened,
    summary.diagnosis,
    summary.treatmentPlan,
    summary.followUp,
    JSON.stringify(summary.warningSigns),
    summary.additionalNotes,
    tooltips ? JSON.stringify(tooltips) : null,
    validation.model,
    validation.status,
    validation.report ? JSON.stringify(validation.report) : null,
    validation.runAt,
  );

  logger.info({ userId, summaryId: id }, "Report summary generated successfully");

  const row = db
    .prepare(
      `SELECT rs.*,
              1 AS is_owner,
              NULL AS assignment_can_write,
              (SELECT role FROM users WHERE id = ?) AS viewer_role
       FROM report_summaries rs
       WHERE rs.id = ?`
    )
    .get(userId, id) as ReportSummaryRowWithAccess;

  return rowToStoredSummary(row);
}

const LIST_SELECT_SQL = `
  SELECT rs.*,
         CASE WHEN rs.user_id = ? THEN 1 ELSE 0 END AS is_owner,
         rsa.can_write AS assignment_can_write,
         u.role AS viewer_role
  FROM report_summaries rs
  LEFT JOIN report_summary_assignments rsa
    ON rsa.report_summary_id = rs.id AND rsa.user_id = ?
  LEFT JOIN users u ON u.id = ?
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

  const rows = db
    .prepare(LIST_SELECT_SQL)
    .all(userId, userId, userId, userId, userId, pageSize, offset) as ReportSummaryRowWithAccess[];

  const total = (
    db
      .prepare(LIST_COUNT_SQL)
      .get(userId, userId, userId) as { count: number }
  ).count;

  return {
    summaries: rows.map(rowToListItem),
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
              rsa.can_write AS assignment_can_write,
              u.role AS viewer_role
       FROM report_summaries rs
       LEFT JOIN report_summary_assignments rsa
         ON rsa.report_summary_id = rs.id AND rsa.user_id = ?
       LEFT JOIN users u ON u.id = ?
       WHERE rs.id = ? AND (rs.user_id = ? OR rsa.user_id = ?)`
    )
    .get(userId, userId, userId, id, userId, userId) as
    | ReportSummaryRowWithAccess
    | undefined;

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
              WHERE share_token = ?
                AND confirmed_at IS NOT NULL
                AND (share_expires_at IS NULL OR share_expires_at > datetime('now'))`,
      titleColumn: "title",
      dateColumn: "created_at",
    },
    token,
  );
}

export function confirmReportSummary(
  id: string,
  userId: string,
): StoredReportSummary {
  const db = getDb();
  // Only the owner can confirm — assignment write access is not enough,
  // because confirmation carries clinical responsibility.
  // Server-side gate: confirmation requires the safety validator to have
  // succeeded (Step 3). Mirrors the paper's release condition.
  const status = db
    .prepare(
      `SELECT validator_status, confirmed_at FROM report_summaries WHERE id = ? AND user_id = ?`,
    )
    .get(id, userId) as { validator_status: string | null; confirmed_at: string | null } | undefined;
  if (!status) throw new AppError(404, "Report summary not found");
  if (!status.confirmed_at && status.validator_status !== "completed") {
    throw new AppError(
      409,
      "Cannot confirm: safety validation has not completed successfully. Retry validation first.",
    );
  }

  const result = db
    .prepare(
      `UPDATE report_summaries
       SET confirmed_at = datetime('now'), confirmed_by = ?, updated_at = datetime('now')
       WHERE id = ? AND user_id = ? AND confirmed_at IS NULL`,
    )
    .run(userId, id, userId);

  if (result.changes === 0 && !status.confirmed_at) {
    throw new AppError(404, "Report summary not found");
  }
  logger.info({ summaryId: id, userId }, "Report summary confirmed");
  const summary = getReportSummary(id, userId);
  if (!summary) throw new AppError(404, "Report summary not found");
  return summary;
}

export async function revalidateReportSummary(
  id: string,
  userId: string,
): Promise<StoredReportSummary> {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT rs.source_text, rs.what_happened, rs.diagnosis, rs.treatment_plan, rs.follow_up,
              rs.warning_signs, rs.additional_notes, rs.tooltips
       FROM report_summaries rs
       LEFT JOIN report_summary_assignments rsa
         ON rsa.report_summary_id = rs.id AND rsa.user_id = ?
       WHERE rs.id = ? AND (rs.user_id = ? OR (rsa.user_id = ? AND rsa.can_write = 1))`,
    )
    .get(userId, id, userId, userId) as
    | {
        source_text: string | null;
        what_happened: string;
        diagnosis: string;
        treatment_plan: string;
        follow_up: string;
        warning_signs: string;
        additional_notes: string | null;
        tooltips: string | null;
      }
    | undefined;

  if (!row) throw new AppError(404, "Report summary not found");
  if (!row.source_text) {
    throw new AppError(
      409,
      "Source text was not stored for this report; revalidation is unavailable. Generate a new report summary instead.",
    );
  }

  const summaryFields = {
    whatHappened: row.what_happened,
    diagnosis: row.diagnosis,
    treatmentPlan: row.treatment_plan,
    followUp: row.follow_up,
    warningSigns: JSON.parse(row.warning_signs) as string[],
    additionalNotes: row.additional_notes,
    tooltips: row.tooltips ? (JSON.parse(row.tooltips) as Record<string, string>) : null,
  };

  const validation = await runSafetyValidation(summaryFields, row.source_text, {
    reportSummaryId: id,
  });

  // A revalidation must invalidate any pre-existing confirmation: the GP must
  // re-review fresh validator output. Share token also clears, mirroring the
  // unconfirm path.
  db.prepare(
    `UPDATE report_summaries
     SET validator_model = ?, validator_status = ?, validator_report = ?, validator_run_at = ?,
         confirmed_at = NULL, confirmed_by = NULL,
         share_token = NULL, share_expires_at = NULL,
         updated_at = datetime('now')
     WHERE id = ? AND user_id = ?`,
  ).run(
    validation.model,
    validation.status,
    validation.report ? JSON.stringify(validation.report) : null,
    validation.runAt,
    id,
    userId,
  );

  const summary = getReportSummary(id, userId);
  if (!summary) throw new AppError(404, "Report summary not found");
  return summary;
}

export function unconfirmReportSummary(
  id: string,
  userId: string,
): StoredReportSummary {
  const db = getDb();
  const result = db
    .prepare(
      `UPDATE report_summaries
       SET confirmed_at = NULL, confirmed_by = NULL,
           share_token = NULL, share_expires_at = NULL,
           updated_at = datetime('now')
       WHERE id = ? AND user_id = ?`,
    )
    .run(id, userId);

  if (result.changes === 0) {
    throw new AppError(404, "Report summary not found");
  }
  logger.info({ summaryId: id, userId }, "Report summary unconfirmed");
  const summary = getReportSummary(id, userId);
  if (!summary) throw new AppError(404, "Report summary not found");
  return summary;
}

export function getReportSummaryPatientView(
  id: string,
  userId: string,
): ConsultationSummaryPublic | null {
  // Guard read access first via the existing getter, then check confirmation.
  const summary = getReportSummary(id, userId);
  if (!summary) return null;
  if (!summary.confirmation.confirmedAt) return null;
  return {
    summary: {
      whatHappened: summary.whatHappened,
      diagnosis: summary.diagnosis,
      treatmentPlan: summary.treatmentPlan,
      followUp: summary.followUp,
      warningSigns: summary.warningSigns,
      additionalNotes: summary.additionalNotes,
      tooltips: summary.tooltips,
    },
    sessionTitle: summary.title,
    sessionDate: summary.createdAt,
    expiresAt: summary.shareExpiresAt,
  };
}
