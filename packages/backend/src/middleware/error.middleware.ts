import type { ErrorRequestHandler } from "express";
import { logger } from "../config/logger.js";
import { ZodError } from "zod";

export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const errorMiddleware: ErrorRequestHandler = (err, _req, res, _next) => {
  logger.error(err);

  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      success: false,
      error: err.message,
    });
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json({
      success: false,
      error: "Validation error",
      details: err.issues,
    });
    return;
  }

  res.status(500).json({
    success: false,
    error: "Internal server error",
  });
};
