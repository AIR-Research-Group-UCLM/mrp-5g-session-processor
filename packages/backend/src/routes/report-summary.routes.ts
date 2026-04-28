import { Router } from "express";
import multer from "multer";
import { DOCUMENT_MIME_TYPE_LIST } from "@mrp/shared";
import { reportSummaryController } from "../controllers/report-summary.controller.js";
import { requireAuth } from "../middleware/auth.middleware.js";
import { requireWriteAccess } from "../middleware/write-access.middleware.js";
import {
  requireReportSummaryReadAccess,
  requireReportSummaryWriteAccess,
} from "../middleware/report-summary-access.middleware.js";

const documentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_req, file, cb) => {
    if ((DOCUMENT_MIME_TYPE_LIST as readonly string[]).includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${file.mimetype}`));
    }
  },
});

export const reportSummaryRoutes = Router();

reportSummaryRoutes.use(requireAuth);

reportSummaryRoutes.get("/", reportSummaryController.list);
reportSummaryRoutes.post("/", requireWriteAccess, reportSummaryController.generate);
reportSummaryRoutes.post(
  "/extract-text",
  requireWriteAccess,
  documentUpload.single("file"),
  reportSummaryController.extractTextFromFile
);
reportSummaryRoutes.get("/:id", requireReportSummaryReadAccess, reportSummaryController.getById);
reportSummaryRoutes.delete("/:id", requireReportSummaryWriteAccess, reportSummaryController.remove);
reportSummaryRoutes.post("/:id/share", requireReportSummaryWriteAccess, reportSummaryController.createShareToken);
reportSummaryRoutes.delete("/:id/share", requireReportSummaryWriteAccess, reportSummaryController.revokeShareToken);
reportSummaryRoutes.post("/:id/confirm", requireReportSummaryWriteAccess, reportSummaryController.confirm);
reportSummaryRoutes.delete("/:id/confirm", requireReportSummaryWriteAccess, reportSummaryController.unconfirm);
reportSummaryRoutes.get("/:id/patient-view", requireReportSummaryReadAccess, reportSummaryController.getPatientView);
reportSummaryRoutes.post("/:id/revalidate", requireReportSummaryWriteAccess, reportSummaryController.revalidate);
