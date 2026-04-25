import { Router } from "express";
import { sessionsController } from "../controllers/sessions.controller.js";
import { requireAuth } from "../middleware/auth.middleware.js";
import { requireWriteAccess } from "../middleware/write-access.middleware.js";
import {
  requireSessionReadAccess,
  requireSessionWriteAccess,
} from "../middleware/session-access.middleware.js";
import { uploadMiddleware } from "../middleware/upload.middleware.js";
import { uploadLimiter } from "../middleware/rate-limit.middleware.js";

export const sessionsRoutes = Router();

sessionsRoutes.use(requireAuth);

// List sessions (includes owned + assigned, no session-specific check needed)
sessionsRoutes.get("/", sessionsController.list);

// Read operations on specific sessions - require session read access
sessionsRoutes.get("/:id", requireSessionReadAccess, sessionsController.getById);
sessionsRoutes.get("/:id/status", requireSessionReadAccess, sessionsController.getStatus);
sessionsRoutes.get("/:id/accuracy", requireSessionReadAccess, sessionsController.getAccuracy);
sessionsRoutes.get("/:id/video", requireSessionReadAccess, sessionsController.getVideoUrl);
sessionsRoutes.get("/:id/video/stream", requireSessionReadAccess, sessionsController.streamVideo);
sessionsRoutes.get("/:id/consultation-summary", requireSessionReadAccess, sessionsController.getConsultationSummary);
sessionsRoutes.post("/:id/consultation-summary", requireSessionWriteAccess, sessionsController.generateConsultationSummary);
sessionsRoutes.post("/:id/consultation-summary/share", requireSessionWriteAccess, sessionsController.createShareToken);
sessionsRoutes.delete("/:id/consultation-summary/share", requireSessionWriteAccess, sessionsController.revokeShareToken);

// Create session - only requires general write access (no session yet)
// Security: Rate limit uploads to prevent abuse, validate magic bytes
sessionsRoutes.post("/", requireWriteAccess, uploadLimiter, ...uploadMiddleware.single("video"), sessionsController.create);

// Write operations on specific sessions - require session write access
// For PATCH: requires canWrite permission
// For DELETE: requires ownership (handled in middleware)
sessionsRoutes.patch("/:id", requireSessionWriteAccess, sessionsController.update);
sessionsRoutes.delete("/:id", requireSessionWriteAccess, sessionsController.delete);
