import type { RequestHandler } from "express";
import { z } from "zod";
import { assignmentService } from "../services/assignment.service.js";

const assignmentInputSchema = z.object({
  sessionId: z.string().uuid("Invalid session ID"),
  canWrite: z.boolean(),
});

const setAssignmentsSchema = z.object({
  assignments: z.array(assignmentInputSchema),
});

const reportSummaryAssignmentInputSchema = z.object({
  reportSummaryId: z.string().uuid("Invalid report summary ID"),
  canWrite: z.boolean(),
});

const setReportSummaryAssignmentsSchema = z.object({
  assignments: z.array(reportSummaryAssignmentInputSchema),
});

/**
 * Get all sessions available for assignment to a user.
 * Returns sessions NOT owned by the target user, with current assignment status.
 */
const getAvailableSessions: RequestHandler = async (req, res, next) => {
  try {
    const targetUserId = req.params.userId!;
    const sessions = await assignmentService.getAllSessionsForAssignment(
      targetUserId
    );
    res.json({ success: true, data: { sessions } });
  } catch (error) {
    next(error);
  }
};

/**
 * Get current assignments for a user.
 */
const getUserAssignments: RequestHandler = async (req, res, next) => {
  try {
    const targetUserId = req.params.userId!;
    const assignments = await assignmentService.getAssignmentsForUser(
      targetUserId
    );
    res.json({ success: true, data: { assignments } });
  } catch (error) {
    next(error);
  }
};

/**
 * Set assignments for a user (replaces all existing assignments).
 */
const setUserAssignments: RequestHandler = async (req, res, next) => {
  try {
    const targetUserId = req.params.userId!;
    const adminUserId = req.session.userId!;
    const { assignments } = setAssignmentsSchema.parse(req.body);

    await assignmentService.setAssignmentsForUser(
      targetUserId,
      assignments,
      adminUserId
    );

    const updatedAssignments = await assignmentService.getAssignmentsForUser(
      targetUserId
    );
    res.json({ success: true, data: { assignments: updatedAssignments } });
  } catch (error) {
    next(error);
  }
};

/**
 * Get all report summaries available for assignment to a user.
 */
const getAvailableReportSummaries: RequestHandler = async (req, res, next) => {
  try {
    const targetUserId = req.params.userId!;
    const reportSummaries =
      await assignmentService.getAllReportSummariesForAssignment(targetUserId);
    res.json({ success: true, data: { reportSummaries } });
  } catch (error) {
    next(error);
  }
};

/**
 * Get current report-summary assignments for a user.
 */
const getUserReportSummaryAssignments: RequestHandler = async (
  req,
  res,
  next
) => {
  try {
    const targetUserId = req.params.userId!;
    const assignments =
      await assignmentService.getReportSummaryAssignmentsForUser(targetUserId);
    res.json({ success: true, data: { assignments } });
  } catch (error) {
    next(error);
  }
};

/**
 * Set report-summary assignments for a user (replaces all existing).
 */
const setUserReportSummaryAssignments: RequestHandler = async (
  req,
  res,
  next
) => {
  try {
    const targetUserId = req.params.userId!;
    const adminUserId = req.session.userId!;
    const { assignments } = setReportSummaryAssignmentsSchema.parse(req.body);

    await assignmentService.setReportSummaryAssignmentsForUser(
      targetUserId,
      assignments,
      adminUserId
    );

    const updatedAssignments =
      await assignmentService.getReportSummaryAssignmentsForUser(targetUserId);
    res.json({ success: true, data: { assignments: updatedAssignments } });
  } catch (error) {
    next(error);
  }
};

export const assignmentsController = {
  getAvailableSessions,
  getUserAssignments,
  setUserAssignments,
  getAvailableReportSummaries,
  getUserReportSummaryAssignments,
  setUserReportSummaryAssignments,
};
