import { v4 as uuidv4 } from "uuid";
import { getDb } from "../db/connection.js";
import type {
  SessionForAssignment,
  AssignmentInput,
  SessionAssignmentListItem,
  ReportSummaryForAssignment,
  ReportSummaryAssignmentInput,
  ReportSummaryAssignmentListItem,
} from "@mrp/shared";

interface AccessCheckResult {
  canAccess: boolean;
  isOwner: boolean;
  canWrite: boolean;
}

interface ResourceConfig {
  resourceTable: string;
  assignmentTable: string;
  fkColumn: string;
}

const SESSION_CFG: ResourceConfig = {
  resourceTable: "medical_sessions",
  assignmentTable: "session_assignments",
  fkColumn: "session_id",
};

const REPORT_CFG: ResourceConfig = {
  resourceTable: "report_summaries",
  assignmentTable: "report_summary_assignments",
  fkColumn: "report_summary_id",
};

async function checkAccess(
  cfg: ResourceConfig,
  userId: string,
  resourceId: string
): Promise<AccessCheckResult> {
  const db = getDb();

  const row = db
    .prepare(
      `SELECT
         r.user_id AS owner_id,
         a.can_write AS assignment_can_write,
         u.role AS user_role
       FROM ${cfg.resourceTable} r
       LEFT JOIN ${cfg.assignmentTable} a
         ON a.${cfg.fkColumn} = r.id AND a.user_id = ?
       LEFT JOIN users u ON u.id = ?
       WHERE r.id = ?`
    )
    .get(userId, userId, resourceId) as
    | {
        owner_id: string;
        assignment_can_write: number | null;
        user_role: string | null;
      }
    | undefined;

  if (!row) {
    return { canAccess: false, isOwner: false, canWrite: false };
  }

  if (row.owner_id === userId) {
    return { canAccess: true, isOwner: true, canWrite: true };
  }

  if (row.assignment_can_write === null) {
    return { canAccess: false, isOwner: false, canWrite: false };
  }

  const canWrite =
    row.assignment_can_write === 1 && row.user_role !== "readonly";

  return { canAccess: true, isOwner: false, canWrite };
}

function setAssignmentsGeneric(
  cfg: ResourceConfig,
  targetUserId: string,
  resourceIds: { id: string; canWrite: boolean }[],
  assignedBy: string
): void {
  const db = getDb();

  const ownedRows = db
    .prepare(`SELECT id FROM ${cfg.resourceTable} WHERE user_id = ?`)
    .all(targetUserId) as { id: string }[];
  const ownedIds = new Set(ownedRows.map((r) => r.id));

  const validAssignments = resourceIds.filter((a) => !ownedIds.has(a.id));

  const transaction = db.transaction(() => {
    db.prepare(
      `DELETE FROM ${cfg.assignmentTable} WHERE user_id = ?`
    ).run(targetUserId);

    const insertStmt = db.prepare(
      `INSERT INTO ${cfg.assignmentTable} (id, ${cfg.fkColumn}, user_id, can_write, assigned_by)
       VALUES (?, ?, ?, ?, ?)`
    );

    for (const a of validAssignments) {
      insertStmt.run(
        uuidv4(),
        a.id,
        targetUserId,
        a.canWrite ? 1 : 0,
        assignedBy
      );
    }
  });

  transaction();
}

function getAssignedIdsGeneric(
  cfg: ResourceConfig,
  userId: string
): string[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT ${cfg.fkColumn} AS resource_id FROM ${cfg.assignmentTable} WHERE user_id = ?`
    )
    .all(userId) as { resource_id: string }[];
  return rows.map((r) => r.resource_id);
}

// --- Session-specific public API ---

async function canUserAccessSession(
  userId: string,
  sessionId: string
): Promise<AccessCheckResult> {
  return checkAccess(SESSION_CFG, userId, sessionId);
}

async function getAssignmentsForUser(
  userId: string
): Promise<SessionAssignmentListItem[]> {
  const db = getDb();

  const rows = db
    .prepare(
      `
    SELECT
      ms.id as session_id,
      ms.title as session_title,
      ms.status as session_status,
      ms.created_at as session_created_at,
      u.name as owner_name,
      u.id as owner_id,
      sa.can_write
    FROM session_assignments sa
    JOIN medical_sessions ms ON ms.id = sa.session_id
    JOIN users u ON u.id = ms.user_id
    WHERE sa.user_id = ?
    ORDER BY ms.created_at DESC
  `
    )
    .all(userId) as Array<{
    session_id: string;
    session_title: string | null;
    session_status: string;
    session_created_at: string;
    owner_name: string;
    owner_id: string;
    can_write: number;
  }>;

  return rows.map((row) => ({
    sessionId: row.session_id,
    sessionTitle: row.session_title,
    sessionStatus: row.session_status,
    sessionCreatedAt: row.session_created_at,
    ownerName: row.owner_name,
    ownerId: row.owner_id,
    canWrite: row.can_write === 1,
  }));
}

async function getAllSessionsForAssignment(
  targetUserId: string
): Promise<SessionForAssignment[]> {
  const db = getDb();

  const rows = db
    .prepare(
      `
    SELECT
      ms.id,
      ms.title,
      ms.status,
      ms.created_at,
      u.name as owner_name,
      u.id as owner_id,
      sa.id as assignment_id,
      sa.can_write
    FROM medical_sessions ms
    JOIN users u ON u.id = ms.user_id
    LEFT JOIN session_assignments sa ON sa.session_id = ms.id AND sa.user_id = ?
    WHERE ms.user_id != ?
    ORDER BY ms.created_at DESC
  `
    )
    .all(targetUserId, targetUserId) as Array<{
    id: string;
    title: string | null;
    status: string;
    created_at: string;
    owner_name: string;
    owner_id: string;
    assignment_id: string | null;
    can_write: number | null;
  }>;

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    status: row.status,
    ownerName: row.owner_name,
    ownerId: row.owner_id,
    createdAt: row.created_at,
    isAssigned: row.assignment_id !== null,
    canWrite: row.can_write === 1,
  }));
}

async function setAssignmentsForUser(
  targetUserId: string,
  assignments: AssignmentInput[],
  assignedBy: string
): Promise<void> {
  setAssignmentsGeneric(
    SESSION_CFG,
    targetUserId,
    assignments.map((a) => ({ id: a.sessionId, canWrite: a.canWrite })),
    assignedBy
  );
}

async function getAssignedSessionIds(userId: string): Promise<string[]> {
  return getAssignedIdsGeneric(SESSION_CFG, userId);
}

// --- Report-summary-specific public API ---

async function canUserAccessReportSummary(
  userId: string,
  reportSummaryId: string
): Promise<AccessCheckResult> {
  return checkAccess(REPORT_CFG, userId, reportSummaryId);
}

async function getReportSummaryAssignmentsForUser(
  userId: string
): Promise<ReportSummaryAssignmentListItem[]> {
  const db = getDb();

  const rows = db
    .prepare(
      `
    SELECT
      rs.id as report_summary_id,
      rs.title as report_summary_title,
      rs.created_at as report_summary_created_at,
      u.name as owner_name,
      u.id as owner_id,
      rsa.can_write
    FROM report_summary_assignments rsa
    JOIN report_summaries rs ON rs.id = rsa.report_summary_id
    JOIN users u ON u.id = rs.user_id
    WHERE rsa.user_id = ?
    ORDER BY rs.created_at DESC
  `
    )
    .all(userId) as Array<{
    report_summary_id: string;
    report_summary_title: string | null;
    report_summary_created_at: string;
    owner_name: string;
    owner_id: string;
    can_write: number;
  }>;

  return rows.map((row) => ({
    reportSummaryId: row.report_summary_id,
    reportSummaryTitle: row.report_summary_title,
    reportSummaryCreatedAt: row.report_summary_created_at,
    ownerName: row.owner_name,
    ownerId: row.owner_id,
    canWrite: row.can_write === 1,
  }));
}

async function getAllReportSummariesForAssignment(
  targetUserId: string
): Promise<ReportSummaryForAssignment[]> {
  const db = getDb();

  const rows = db
    .prepare(
      `
    SELECT
      rs.id,
      rs.title,
      rs.created_at,
      u.name as owner_name,
      u.id as owner_id,
      rsa.id as assignment_id,
      rsa.can_write
    FROM report_summaries rs
    JOIN users u ON u.id = rs.user_id
    LEFT JOIN report_summary_assignments rsa ON rsa.report_summary_id = rs.id AND rsa.user_id = ?
    WHERE rs.user_id != ?
    ORDER BY rs.created_at DESC
  `
    )
    .all(targetUserId, targetUserId) as Array<{
    id: string;
    title: string | null;
    created_at: string;
    owner_name: string;
    owner_id: string;
    assignment_id: string | null;
    can_write: number | null;
  }>;

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    ownerName: row.owner_name,
    ownerId: row.owner_id,
    createdAt: row.created_at,
    isAssigned: row.assignment_id !== null,
    canWrite: row.can_write === 1,
  }));
}

async function setReportSummaryAssignmentsForUser(
  targetUserId: string,
  assignments: ReportSummaryAssignmentInput[],
  assignedBy: string
): Promise<void> {
  setAssignmentsGeneric(
    REPORT_CFG,
    targetUserId,
    assignments.map((a) => ({ id: a.reportSummaryId, canWrite: a.canWrite })),
    assignedBy
  );
}

async function getAssignedReportSummaryIds(
  userId: string
): Promise<string[]> {
  return getAssignedIdsGeneric(REPORT_CFG, userId);
}

export const assignmentService = {
  canUserAccessSession,
  getAssignmentsForUser,
  getAllSessionsForAssignment,
  setAssignmentsForUser,
  getAssignedSessionIds,
  canUserAccessReportSummary,
  getReportSummaryAssignmentsForUser,
  getAllReportSummariesForAssignment,
  setReportSummaryAssignmentsForUser,
  getAssignedReportSummaryIds,
};
