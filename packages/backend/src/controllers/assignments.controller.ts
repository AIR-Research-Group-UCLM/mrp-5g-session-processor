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

export const assignmentsController = {
  getAvailableSessions,
  getUserAssignments,
  setUserAssignments,
};
