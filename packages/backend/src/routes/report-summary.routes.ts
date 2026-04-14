import { Router } from "express";
import multer from "multer";
import { reportSummaryController } from "../controllers/report-summary.controller.js";
import { requireAuth } from "../middleware/auth.middleware.js";
import { requireWriteAccess } from "../middleware/write-access.middleware.js";

const documentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_req, file, cb) => {
    const allowed = [
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.oasis.opendocument.text",
    ];
    if (allowed.includes(file.mimetype)) {
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
reportSummaryRoutes.get("/:id", reportSummaryController.getById);
reportSummaryRoutes.delete("/:id", requireWriteAccess, reportSummaryController.remove);
reportSummaryRoutes.post("/:id/share", reportSummaryController.createShareToken);
reportSummaryRoutes.delete("/:id/share", reportSummaryController.revokeShareToken);
