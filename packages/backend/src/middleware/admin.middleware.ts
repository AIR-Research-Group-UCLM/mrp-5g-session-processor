import type { RequestHandler } from "express";
import { authService } from "../services/auth.service.js";
import { AppError } from "./error.middleware.js";

const ADMIN_EMAIL = "admin@user.com";

export const requireAdmin: RequestHandler = async (req, _res, next) => {
  try {
    if (!req.session.userId) {
      throw new AppError(401, "Authentication required");
    }

    const user = await authService.getUserById(req.session.userId);

    if (!user || user.email !== ADMIN_EMAIL) {
      throw new AppError(403, "Admin access required");
    }

    next();
  } catch (error) {
    next(error);
  }
};
