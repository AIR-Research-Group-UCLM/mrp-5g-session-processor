import type { RequestHandler } from "express";
import { authService } from "../services/auth.service.js";
import { assignmentService } from "../services/assignment.service.js";
import { AppError } from "./error.middleware.js";

/**
 * Middleware to check if a user can read a specific report summary.
 * User must be the owner or have an assignment row for the report.
 */
export const requireReportSummaryReadAccess: RequestHandler = async (
  req,
  _res,
  next
) => {
  try {
    const userId = req.session.userId;
    const reportSummaryId = req.params.id;

    if (!userId) {
      throw new AppError(401, "Authentication required");
    }

    if (!reportSummaryId) {
      throw new AppError(400, "Report summary ID required");
    }

    const { canAccess } = await assignmentService.canUserAccessReportSummary(
      userId,
      reportSummaryId
    );

    if (!canAccess) {
      throw new AppError(404, "Report summary not found");
    }

    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Middleware to check if a user can write to a specific report summary.
 * Requirements:
 * 1. User can access the report (owner or assigned)
 * 2. User's role is NOT readonly
 * 3. User is owner OR assignment has canWrite=true
 * 4. For DELETE: ONLY owner can delete (matches session semantics)
 */
export const requireReportSummaryWriteAccess: RequestHandler = async (
  req,
  _res,
  next
) => {
  try {
    const userId = req.session.userId;
    const reportSummaryId = req.params.id;

    if (!userId) {
      throw new AppError(401, "Authentication required");
    }

    if (!reportSummaryId) {
      throw new AppError(400, "Report summary ID required");
    }

    const user = await authService.getUserById(userId);
    if (!user) {
      throw new AppError(401, "User not found");
    }

    if (user.role === "readonly") {
      throw new AppError(403, "Write access required");
    }

    const { canAccess, isOwner, canWrite } =
      await assignmentService.canUserAccessReportSummary(
        userId,
        reportSummaryId
      );

    if (!canAccess) {
      throw new AppError(404, "Report summary not found");
    }

    if (req.method === "DELETE" && !isOwner) {
      throw new AppError(403, "Only report owner can delete");
    }

    if (!canWrite) {
      throw new AppError(403, "Write access required for this report");
    }

    next();
  } catch (error) {
    next(error);
  }
};
