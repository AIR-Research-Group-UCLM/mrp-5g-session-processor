import crypto from "node:crypto";
import type {
  ConsultationSummary,
  ConsultationSummaryPublic,
  ValidatorState,
  ConfirmationState,
  ValidatorReport,
  ValidatorStatus,
} from "@mrp/shared";
import { config } from "../config/index.js";
import { getDb } from "../db/connection.js";
import { logger } from "../config/logger.js";
import { AppError } from "../middleware/error.middleware.js";

interface ShareTokenTableConfig {
  /** Table name, e.g. "consultation_summaries" or "report_summaries" */
  table: string;
  /** Column used in the WHERE clause to identify the row, e.g. "session_id" or "id" */
  idColumn: string;
  /** Optional extra WHERE column for ownership, e.g. "user_id" */
  ownerColumn?: string;
  /** Label for log/error messages, e.g. "consultation summary" */
  label: string;
}

export function createShareToken(
  cfg: ShareTokenTableConfig,
  id: string,
  ownerId?: string,
  expiryHours?: number | null,
): { token: string; expiresAt: string | null } {
  const db = getDb();

  // Step 3 gate: refuse to issue a share token until the GP has confirmed.
  // The paper guarantees that no sheet reaches the patient without GP review.
  const idCheckWhere = cfg.ownerColumn
    ? `${cfg.idColumn} = ? AND ${cfg.ownerColumn} = ?`
    : `${cfg.idColumn} = ?`;
  const checkParams = cfg.ownerColumn ? [id, ownerId] : [id];
  const row = db
    .prepare(
      `SELECT confirmed_at FROM ${cfg.table} WHERE ${idCheckWhere}`,
    )
    .get(...checkParams) as { confirmed_at: string | null } | undefined;
  if (!row) {
    throw new AppError(404, `${cfg.label} not found`);
  }
  if (!row.confirmed_at) {
    throw new AppError(
      409,
      `${cfg.label} must be confirmed before a share link can be issued`,
    );
  }

  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt =
    expiryHours === null
      ? null
      : new Date(
          Date.now() + (expiryHours ?? config.consultationSummary.shareExpiryHours) * 60 * 60 * 1000
        ).toISOString();

  const where = cfg.ownerColumn
    ? `${cfg.idColumn} = ? AND ${cfg.ownerColumn} = ?`
    : `${cfg.idColumn} = ?`;
  const params = cfg.ownerColumn
    ? [token, expiresAt, id, ownerId]
    : [token, expiresAt, id];

  const result = db.prepare(
    `UPDATE ${cfg.table} SET share_token = ?, share_expires_at = ?, updated_at = datetime('now') WHERE ${where}`
  ).run(...params);

  if (result.changes === 0) {
    throw new AppError(404, `${cfg.label} not found`);
  }

  logger.info({ [cfg.idColumn]: id }, `Share token created for ${cfg.label}`);

  return { token, expiresAt };
}

export function revokeShareToken(
  cfg: ShareTokenTableConfig,
  id: string,
  ownerId?: string,
): void {
  const db = getDb();

  const where = cfg.ownerColumn
    ? `${cfg.idColumn} = ? AND ${cfg.ownerColumn} = ?`
    : `${cfg.idColumn} = ?`;
  const params = cfg.ownerColumn
    ? [id, ownerId]
    : [id];

  const result = db.prepare(
    `UPDATE ${cfg.table} SET share_token = NULL, share_expires_at = NULL, updated_at = datetime('now') WHERE ${where}`
  ).run(...params);

  if (result.changes === 0) {
    throw new AppError(404, `${cfg.label} not found`);
  }

  logger.info({ [cfg.idColumn]: id }, `Share token revoked for ${cfg.label}`);
}

/** Parse the common summary columns from a DB row into a ConsultationSummary. */
export function parseSummaryFields(row: {
  what_happened: string;
  diagnosis: string;
  treatment_plan: string;
  follow_up: string;
  warning_signs: string;
  additional_notes: string | null;
  tooltips?: string | null;
}): ConsultationSummary {
  return {
    whatHappened: row.what_happened,
    diagnosis: row.diagnosis,
    treatmentPlan: row.treatment_plan,
    followUp: row.follow_up,
    warningSigns: JSON.parse(row.warning_signs),
    additionalNotes: row.additional_notes,
    tooltips: row.tooltips ? JSON.parse(row.tooltips) : null,
  };
}

/** Parse the validator + confirmation columns from a DB row. */
export function parseValidatorState(row: {
  validator_status: string | null;
  validator_model: string | null;
  validator_report: string | null;
  validator_run_at: string | null;
}): ValidatorState {
  let report: ValidatorReport | null = null;
  if (row.validator_report) {
    try {
      report = JSON.parse(row.validator_report) as ValidatorReport;
    } catch {
      report = null;
    }
  }
  return {
    status: (row.validator_status as ValidatorStatus | null) ?? null,
    model: row.validator_model,
    report,
    runAt: row.validator_run_at,
  };
}

export function parseConfirmationState(row: {
  confirmed_at: string | null;
  confirmed_by: string | null;
}): ConfirmationState {
  return {
    confirmedAt: row.confirmed_at,
    confirmedBy: row.confirmed_by,
  };
}

/**
 * Look up a share token in a table and return a ConsultationSummaryPublic.
 * `titleExpr` and `dateExpr` are SQL expressions for the title and date fields
 * (can reference joined tables or the main table directly).
 */
export function getByShareToken(
  cfg: {
    query: string;
    titleColumn: string;
    dateColumn: string;
  },
  token: string,
): ConsultationSummaryPublic | null {
  const db = getDb();

  const row = db.prepare(cfg.query).get(token) as
    | (Record<string, unknown> & {
        what_happened: string;
        diagnosis: string;
        treatment_plan: string;
        follow_up: string;
        warning_signs: string;
        additional_notes: string | null;
        share_expires_at: string | null;
      })
    | undefined;

  if (!row) return null;

  return {
    summary: parseSummaryFields(row),
    sessionTitle: (row[cfg.titleColumn] as string | null) ?? null,
    sessionDate: row[cfg.dateColumn] as string,
    expiresAt: row.share_expires_at ?? null,
  };
}
