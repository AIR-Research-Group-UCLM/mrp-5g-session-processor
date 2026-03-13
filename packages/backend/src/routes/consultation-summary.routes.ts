import { Router } from "express";
import { consultationSummaryController } from "../controllers/consultation-summary.controller.js";

export const consultationSummaryRoutes = Router();

// Public — no requireAuth
consultationSummaryRoutes.get("/:token", consultationSummaryController.getByToken);
