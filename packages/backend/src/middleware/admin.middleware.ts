import type { RequestHandler } from "express";
import { authService } from "../services/auth.service.js";
import { AppError } from "./error.middleware.js";

export const requireAdmin: RequestHandler = async (req, _res, next) => {
  try {
    if (!req.userId) {
      throw new AppError(401, "Authentication required");
    }

    // Security: admin endpoints are restricted to interactive logins so a
    // leaked API key can never be used to manage users or other API keys
    if (req.authMethod === "api_key") {
      throw new AppError(403, "Admin endpoints are not available with API key authentication");
    }

    const user = await authService.getUserById(req.userId);

    if (!user || user.role !== "admin") {
      throw new AppError(403, "Admin access required");
    }

    next();
  } catch (error) {
    next(error);
  }
};
