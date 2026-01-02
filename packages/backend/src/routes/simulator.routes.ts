import { Router } from "express";
import { simulatorController } from "../controllers/simulator.controller.js";
import { requireAuth } from "../middleware/auth.middleware.js";
import { requireWriteAccess } from "../middleware/write-access.middleware.js";
import { simulatorLimiter } from "../middleware/rate-limit.middleware.js";

export const simulatorRoutes = Router();

simulatorRoutes.use(requireAuth);

// Read operations
simulatorRoutes.get("/voices", simulatorController.getVoices);
simulatorRoutes.get("/:id/status", simulatorController.getStatus);

// Write operations - require write access
simulatorRoutes.post("/context-suggestion", requireWriteAccess, simulatorController.generateContextSuggestion);
// Security: Rate limit simulation creation to prevent API abuse
simulatorRoutes.post("/", requireWriteAccess, simulatorLimiter, simulatorController.create);
