import type { RequestHandler } from "express";
import { AppError } from "./error.middleware.js";

declare module "express-session" {
  interface SessionData {
    userId: string;
  }
}

export const requireAuth: RequestHandler = (req, _res, next) => {
  if (!req.session.userId) {
    throw new AppError(401, "Authentication required");
  }
  next();
};
