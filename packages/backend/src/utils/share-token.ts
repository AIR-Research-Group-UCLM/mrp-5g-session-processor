import crypto from "node:crypto";
import type { ConsultationSummary, ConsultationSummaryPublic } from "@mrp/shared";
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
): { token: string; expiresAt: string } {
  const db = getDb();

  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(
    Date.now() + config.consultationSummary.shareExpiryHours * 60 * 60 * 1000
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

/** Parse the 6 common summary columns from a DB row into a ConsultationSummary. */
export function parseSummaryFields(row: {
  what_happened: string;
  diagnosis: string;
  treatment_plan: string;
  follow_up: string;
  warning_signs: string;
  additional_notes: string | null;
}): ConsultationSummary {
  return {
    whatHappened: row.what_happened,
    diagnosis: row.diagnosis,
    treatmentPlan: row.treatment_plan,
    followUp: row.follow_up,
    warningSigns: JSON.parse(row.warning_signs),
    additionalNotes: row.additional_notes,
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
    expiresAt: row.share_expires_at!,
  };
}
