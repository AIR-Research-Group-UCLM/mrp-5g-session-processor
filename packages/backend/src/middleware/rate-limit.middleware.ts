import type { Request, Response } from "express";
import { rateLimit, ipKeyGenerator } from "express-rate-limit";
import { logger } from "../config/logger.js";

// Helper to get normalized IP using express-rate-limit's IPv6-safe helper
function getIpKey(req: Request): string {
  return ipKeyGenerator(req.ip ?? "unknown");
}

// Helper to get client identifier (user ID if authenticated, IP otherwise)
function getClientId(req: Request): string {
  // For authenticated users, use userId as the key
  if (req.session?.userId) {
    return req.session.userId;
  }
  // For unauthenticated users, use the proper IP key generator for IPv6 support
  return getIpKey(req);
}

// General API rate limiter - 100 requests per minute
// Note: Health checks at /health are outside /api, so they bypass this limiter automatically
export const generalLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getClientId,
  handler: (_req: Request, res: Response) => {
    res.status(429).json({
      success: false,
      error: "Too many requests, please try again later",
    });
  },
});

// Strict rate limiter for authentication - 5 attempts per 15 minutes per IP
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getIpKey,
  handler: (req: Request, res: Response) => {
    logger.warn({ ip: getIpKey(req) }, "Auth rate limit exceeded");
    res.status(429).json({
      success: false,
      error: "Too many login attempts, please try again in 15 minutes",
    });
  },
});

// Simulator rate limiter - 10 requests per hour per user (expensive API calls)
export const simulatorLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getClientId,
  handler: (req: Request, res: Response) => {
    logger.warn({ userId: req.session?.userId }, "Simulator rate limit exceeded");
    res.status(429).json({
      success: false,
      error: "Simulation limit reached, please try again in an hour",
    });
  },
});

// Upload rate limiter - 20 uploads per hour per user
export const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getClientId,
  handler: (req: Request, res: Response) => {
    logger.warn({ userId: req.session?.userId }, "Upload rate limit exceeded");
    res.status(429).json({
      success: false,
      error: "Upload limit reached, please try again later",
    });
  },
});
