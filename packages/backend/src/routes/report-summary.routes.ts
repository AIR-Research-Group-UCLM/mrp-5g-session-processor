import { Router } from "express";
import { reportSummaryController } from "../controllers/report-summary.controller.js";
import { requireAuth } from "../middleware/auth.middleware.js";
import { requireWriteAccess } from "../middleware/write-access.middleware.js";

export const reportSummaryRoutes = Router();

reportSummaryRoutes.use(requireAuth);

reportSummaryRoutes.get("/", reportSummaryController.list);
reportSummaryRoutes.post("/", requireWriteAccess, reportSummaryController.generate);
reportSummaryRoutes.get("/:id", reportSummaryController.getById);
reportSummaryRoutes.delete("/:id", requireWriteAccess, reportSummaryController.remove);
reportSummaryRoutes.post("/:id/share", reportSummaryController.createShareToken);
reportSummaryRoutes.delete("/:id/share", reportSummaryController.revokeShareToken);
