import { Router } from "express";
import { simulatorController } from "../controllers/simulator.controller.js";
import { requireAuth } from "../middleware/auth.middleware.js";
import { simulatorLimiter } from "../middleware/rate-limit.middleware.js";

export const simulatorRoutes = Router();

simulatorRoutes.use(requireAuth);

simulatorRoutes.get("/voices", simulatorController.getVoices);
simulatorRoutes.post("/context-suggestion", simulatorController.generateContextSuggestion);
// Security: Rate limit simulation creation to prevent API abuse
simulatorRoutes.post("/", simulatorLimiter, simulatorController.create);
simulatorRoutes.get("/:id/status", simulatorController.getStatus);
