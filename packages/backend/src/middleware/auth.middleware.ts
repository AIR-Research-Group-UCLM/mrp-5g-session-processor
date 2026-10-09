import type { Request, RequestHandler } from "express";
import { apiKeyService } from "../services/api-key.service.js";
import { AppError } from "./error.middleware.js";

declare module "express-session" {
  interface SessionData {
    userId: string;
  }
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Authenticated user, resolved from the session cookie or an API key */
      userId?: string;
      authMethod?: "session" | "api_key";
      apiKeyId?: string;
    }
  }
}

function extractApiKey(req: Request): string | null {
  const headerKey = req.get("x-api-key");
  if (headerKey) {
    return headerKey.trim();
  }

  const authorization = req.get("authorization");
  if (authorization?.toLowerCase().startsWith("bearer ")) {
    return authorization.slice("bearer ".length).trim();
  }

  return null;
}

// Resolves the caller identity for every API request. An API key, when present,
// takes precedence over the session cookie; an invalid key is rejected outright
// instead of silently falling back to anonymous access.
export const authenticate: RequestHandler = (req, _res, next) => {
  const apiKey = extractApiKey(req);

  if (apiKey) {
    const result = apiKeyService.authenticate(apiKey);
    if (!result) {
      throw new AppError(401, "Invalid or expired API key");
    }
    req.userId = result.userId;
    req.authMethod = "api_key";
    req.apiKeyId = result.keyId;
  } else if (req.session.userId) {
    req.userId = req.session.userId;
    req.authMethod = "session";
  }

  next();
};

export const requireAuth: RequestHandler = (req, _res, next) => {
  if (!req.userId) {
    throw new AppError(401, "Authentication required");
  }
  next();
};
