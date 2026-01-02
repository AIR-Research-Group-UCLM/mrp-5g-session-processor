import type { RequestHandler } from "express";
import { authService } from "../services/auth.service.js";
import { AppError } from "./error.middleware.js";

export const requireWriteAccess: RequestHandler = async (req, _res, next) => {
  try {
    if (!req.session.userId) {
      throw new AppError(401, "Authentication required");
    }

    const user = await authService.getUserById(req.session.userId);

    if (!user) {
      throw new AppError(401, "User not found");
    }

    if (user.role === "readonly") {
      throw new AppError(403, "Write access required");
    }

    next();
  } catch (error) {
    next(error);
  }
};
