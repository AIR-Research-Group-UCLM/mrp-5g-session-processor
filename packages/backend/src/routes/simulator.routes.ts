import { Router } from "express";
import { simulatorController } from "../controllers/simulator.controller.js";
import { requireAuth } from "../middleware/auth.middleware.js";

export const simulatorRoutes = Router();

simulatorRoutes.use(requireAuth);

simulatorRoutes.get("/voices", simulatorController.getVoices);
simulatorRoutes.post("/", simulatorController.create);
simulatorRoutes.get("/:id/status", simulatorController.getStatus);
