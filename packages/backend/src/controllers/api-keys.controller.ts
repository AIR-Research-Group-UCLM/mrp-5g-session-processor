import type { RequestHandler } from "express";
import { z } from "zod";
import { apiKeyService } from "../services/api-key.service.js";
import { authService } from "../services/auth.service.js";
import { AppError } from "../middleware/error.middleware.js";

const createApiKeySchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  expiresInDays: z.number().int().positive().max(3650).nullable().optional(),
});

const list: RequestHandler = async (req, res, next) => {
  try {
    const userId = req.params.userId!;
    const apiKeys = apiKeyService.listByUser(userId);
    res.json({ success: true, data: { apiKeys } });
  } catch (error) {
    next(error);
  }
};

const create: RequestHandler = async (req, res, next) => {
  try {
    const userId = req.params.userId!;
    const input = createApiKeySchema.parse(req.body);

    const user = await authService.getUserById(userId);
    if (!user) {
      throw new AppError(404, "User not found");
    }

    const result = apiKeyService.create(userId, input, req.userId!);
    res.status(201).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
};

const revoke: RequestHandler = async (req, res, next) => {
  try {
    const userId = req.params.userId!;
    const keyId = req.params.keyId!;

    const revoked = apiKeyService.revoke(userId, keyId);
    if (!revoked) {
      throw new AppError(404, "API key not found");
    }

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
};

export const apiKeysController = { list, create, revoke };
