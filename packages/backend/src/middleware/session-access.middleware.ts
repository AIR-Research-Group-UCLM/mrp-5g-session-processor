import type { RequestHandler } from "express";
import { authService } from "../services/auth.service.js";
import { assignmentService } from "../services/assignment.service.js";
import { AppError } from "./error.middleware.js";

/**
 * Middleware to check if user can read a specific session.
 * User must be either the owner or assigned to the session.
 */
export const requireSessionReadAccess: RequestHandler = async (req, _res, next) => {
  try {
    const userId = req.session.userId;
    const sessionId = req.params.id;

    if (!userId) {
      throw new AppError(401, "Authentication required");
    }

    if (!sessionId) {
      throw new AppError(400, "Session ID required");
    }

    const { canAccess } = await assignmentService.canUserAccessSession(
      userId,
      sessionId
    );

    if (!canAccess) {
      throw new AppError(404, "Session not found");
    }

    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Middleware to check if user can write to a specific session.
 * Requirements:
 * 1. User can access the session (owner or assigned)
 * 2. User's role is NOT readonly
 * 3. User is owner OR assignment has canWrite=true
 * 4. For DELETE: ONLY owner can delete (even if user has canWrite)
 */
export const requireSessionWriteAccess: RequestHandler = async (req, _res, next) => {
  try {
    const userId = req.session.userId;
    const sessionId = req.params.id;

    if (!userId) {
      throw new AppError(401, "Authentication required");
    }

    if (!sessionId) {
      throw new AppError(400, "Session ID required");
    }

    const user = await authService.getUserById(userId);
    if (!user) {
      throw new AppError(401, "User not found");
    }

    // Readonly users can never write
    if (user.role === "readonly") {
      throw new AppError(403, "Write access required");
    }

    const { canAccess, isOwner, canWrite } =
      await assignmentService.canUserAccessSession(userId, sessionId);

    if (!canAccess) {
      throw new AppError(404, "Session not found");
    }

    // For DELETE, only owner can delete
    if (req.method === "DELETE" && !isOwner) {
      throw new AppError(403, "Only session owner can delete");
    }

    // For other write operations, check canWrite
    if (!canWrite) {
      throw new AppError(403, "Write access required for this session");
    }

    next();
  } catch (error) {
    next(error);
  }
};
