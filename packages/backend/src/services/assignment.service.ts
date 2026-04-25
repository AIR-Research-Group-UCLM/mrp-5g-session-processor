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

interface DbUser {
  id: string;
  role: string;
}

interface AccessCheckResult {
  canAccess: boolean;
  isOwner: boolean;
  canWrite: boolean;
}

/**
 * Check if a user can access a specific session.
 * Returns access info including ownership and write permissions.
 */
async function canUserAccessSession(
  userId: string,
  sessionId: string
): Promise<AccessCheckResult> {
  const db = getDb();

  // Check if session exists and get owner
  const session = db
    .prepare("SELECT user_id FROM medical_sessions WHERE id = ?")
    .get(sessionId) as { user_id: string } | undefined;

  if (!session) {
    return { canAccess: false, isOwner: false, canWrite: false };
  }

  // Check if user is owner
  if (session.user_id === userId) {
    return { canAccess: true, isOwner: true, canWrite: true };
  }

  // Check if user is assigned
  const assignment = db
    .prepare(
      "SELECT can_write FROM session_assignments WHERE session_id = ? AND user_id = ?"
    )
    .get(sessionId, userId) as { can_write: number } | undefined;

  if (!assignment) {
    return { canAccess: false, isOwner: false, canWrite: false };
  }

  // User is assigned - check if they can write
  // canWrite requires: assignment.can_write = 1 AND user.role != 'readonly'
  const user = db
    .prepare("SELECT role FROM users WHERE id = ?")
    .get(userId) as DbUser | undefined;

  if (!user) {
    return { canAccess: false, isOwner: false, canWrite: false };
  }

  const canWrite = assignment.can_write === 1 && user.role !== "readonly";

  return { canAccess: true, isOwner: false, canWrite };
}

/**
 * Get all sessions assigned to a user (not owned, just assigned).
 */
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

/**
 * Get all sessions available for assignment to a user.
 * Returns sessions NOT owned by the target user, with current assignment status.
 */
async function getAllSessionsForAssignment(
  targetUserId: string
): Promise<SessionForAssignment[]> {
  const db = getDb();

  // Get sessions that are NOT owned by the target user
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

/**
 * Set assignments for a user (replaces all existing assignments).
 * Uses a transaction to ensure atomicity.
 */
async function setAssignmentsForUser(
  targetUserId: string,
  assignments: AssignmentInput[],
  assignedBy: string
): Promise<void> {
  const db = getDb();

  // Get sessions owned by the target user (can't assign to owner)
  const ownedSessions = db
    .prepare("SELECT id FROM medical_sessions WHERE user_id = ?")
    .all(targetUserId) as { id: string }[];
  const ownedIds = new Set(ownedSessions.map((s) => s.id));

  // Filter out sessions that the user owns
  const validAssignments = assignments.filter((a) => !ownedIds.has(a.sessionId));

  // Use transaction for atomicity
  const transaction = db.transaction(() => {
    // Remove all existing assignments for this user
    db.prepare("DELETE FROM session_assignments WHERE user_id = ?").run(
      targetUserId
    );

    // Add new assignments
    const insertStmt = db.prepare(`
      INSERT INTO session_assignments (id, session_id, user_id, can_write, assigned_by)
      VALUES (?, ?, ?, ?, ?)
    `);

    for (const assignment of validAssignments) {
      insertStmt.run(
        uuidv4(),
        assignment.sessionId,
        targetUserId,
        assignment.canWrite ? 1 : 0,
        assignedBy
      );
    }
  });

  transaction();
}

/**
 * Get assignment IDs for a user (for quick lookup).
 */
async function getAssignedSessionIds(userId: string): Promise<string[]> {
  const db = getDb();

  const rows = db
    .prepare("SELECT session_id FROM session_assignments WHERE user_id = ?")
    .all(userId) as { session_id: string }[];

  return rows.map((r) => r.session_id);
}

// --- Report-summary assignments (parallel to sessions above) ---

/**
 * Check if a user can access a specific report summary.
 * Returns access info including ownership and write permissions.
 */
async function canUserAccessReportSummary(
  userId: string,
  reportSummaryId: string
): Promise<AccessCheckResult> {
  const db = getDb();

  const report = db
    .prepare("SELECT user_id FROM report_summaries WHERE id = ?")
    .get(reportSummaryId) as { user_id: string } | undefined;

  if (!report) {
    return { canAccess: false, isOwner: false, canWrite: false };
  }

  if (report.user_id === userId) {
    return { canAccess: true, isOwner: true, canWrite: true };
  }

  const assignment = db
    .prepare(
      "SELECT can_write FROM report_summary_assignments WHERE report_summary_id = ? AND user_id = ?"
    )
    .get(reportSummaryId, userId) as { can_write: number } | undefined;

  if (!assignment) {
    return { canAccess: false, isOwner: false, canWrite: false };
  }

  const user = db
    .prepare("SELECT role FROM users WHERE id = ?")
    .get(userId) as DbUser | undefined;

  if (!user) {
    return { canAccess: false, isOwner: false, canWrite: false };
  }

  const canWrite = assignment.can_write === 1 && user.role !== "readonly";

  return { canAccess: true, isOwner: false, canWrite };
}

/**
 * Get all report summaries assigned to a user (not owned, just assigned).
 */
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

/**
 * Get all report summaries available for assignment to a user.
 * Returns report summaries NOT owned by the target user, with current assignment status.
 */
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

/**
 * Set report-summary assignments for a user (replaces all existing assignments).
 */
async function setReportSummaryAssignmentsForUser(
  targetUserId: string,
  assignments: ReportSummaryAssignmentInput[],
  assignedBy: string
): Promise<void> {
  const db = getDb();

  // Exclude summaries the target user already owns
  const ownedReports = db
    .prepare("SELECT id FROM report_summaries WHERE user_id = ?")
    .all(targetUserId) as { id: string }[];
  const ownedIds = new Set(ownedReports.map((r) => r.id));

  const validAssignments = assignments.filter(
    (a) => !ownedIds.has(a.reportSummaryId)
  );

  const transaction = db.transaction(() => {
    db.prepare(
      "DELETE FROM report_summary_assignments WHERE user_id = ?"
    ).run(targetUserId);

    const insertStmt = db.prepare(`
      INSERT INTO report_summary_assignments (id, report_summary_id, user_id, can_write, assigned_by)
      VALUES (?, ?, ?, ?, ?)
    `);

    for (const assignment of validAssignments) {
      insertStmt.run(
        uuidv4(),
        assignment.reportSummaryId,
        targetUserId,
        assignment.canWrite ? 1 : 0,
        assignedBy
      );
    }
  });

  transaction();
}

/**
 * Get report summary IDs assigned to a user (for quick lookup).
 */
async function getAssignedReportSummaryIds(
  userId: string
): Promise<string[]> {
  const db = getDb();

  const rows = db
    .prepare(
      "SELECT report_summary_id FROM report_summary_assignments WHERE user_id = ?"
    )
    .all(userId) as { report_summary_id: string }[];

  return rows.map((r) => r.report_summary_id);
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
