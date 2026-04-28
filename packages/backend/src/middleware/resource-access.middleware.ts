import type { RequestHandler } from "express";
import { authService } from "../services/auth.service.js";
import { AppError } from "./error.middleware.js";

interface AccessCheckResult {
  canAccess: boolean;
  isOwner: boolean;
  canWrite: boolean;
}

interface ResourceAccessConfig {
  paramName: string;
  notFoundMessage: string;
  deleteForbiddenMessage: string;
  writeForbiddenMessage: string;
  checkAccess: (
    userId: string,
    resourceId: string
  ) => Promise<AccessCheckResult>;
}

export function createResourceAccessMiddleware(config: ResourceAccessConfig): {
  requireRead: RequestHandler;
  requireWrite: RequestHandler;
} {
  const requireRead: RequestHandler = async (req, _res, next) => {
    try {
      const userId = req.session.userId;
      const resourceId = req.params[config.paramName];

      if (!userId) throw new AppError(401, "Authentication required");
      if (!resourceId) throw new AppError(400, `${config.paramName} required`);

      const { canAccess } = await config.checkAccess(userId, resourceId);
      if (!canAccess) throw new AppError(404, config.notFoundMessage);

      next();
    } catch (error) {
      next(error);
    }
  };

  const requireWrite: RequestHandler = async (req, _res, next) => {
    try {
      const userId = req.session.userId;
      const resourceId = req.params[config.paramName];

      if (!userId) throw new AppError(401, "Authentication required");
      if (!resourceId) throw new AppError(400, `${config.paramName} required`);

      const user = await authService.getUserById(userId);
      if (!user) throw new AppError(401, "User not found");
      if (user.role === "readonly") {
        throw new AppError(403, "Write access required");
      }

      const { canAccess, isOwner, canWrite } = await config.checkAccess(
        userId,
        resourceId
      );
      if (!canAccess) throw new AppError(404, config.notFoundMessage);

      if (req.method === "DELETE" && !isOwner) {
        throw new AppError(403, config.deleteForbiddenMessage);
      }
      if (!canWrite) {
        throw new AppError(403, config.writeForbiddenMessage);
      }

      next();
    } catch (error) {
      next(error);
    }
  };

  return { requireRead, requireWrite };
}
