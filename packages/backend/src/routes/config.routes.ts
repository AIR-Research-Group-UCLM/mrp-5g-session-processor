import { Router } from "express";
import { configController } from "../controllers/config.controller.js";
import { requireAuth } from "../middleware/auth.middleware.js";

export const configRoutes = Router();

configRoutes.use(requireAuth);

// Runtime capabilities/config for the frontend (no secrets).
configRoutes.get("/", configController.getConfig);
