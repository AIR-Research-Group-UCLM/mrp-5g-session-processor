import { Router } from "express";
import { sessionsController } from "../controllers/sessions.controller.js";
import { requireAuth } from "../middleware/auth.middleware.js";
import { requireWriteAccess } from "../middleware/write-access.middleware.js";
import { uploadMiddleware } from "../middleware/upload.middleware.js";
import { uploadLimiter } from "../middleware/rate-limit.middleware.js";

export const sessionsRoutes = Router();

sessionsRoutes.use(requireAuth);

// Read operations
sessionsRoutes.get("/", sessionsController.list);
sessionsRoutes.get("/:id", sessionsController.getById);
sessionsRoutes.get("/:id/status", sessionsController.getStatus);
sessionsRoutes.get("/:id/accuracy", sessionsController.getAccuracy);
sessionsRoutes.get("/:id/video", sessionsController.getVideoUrl);
sessionsRoutes.get("/:id/video/stream", sessionsController.streamVideo);

// Write operations - require write access
// Security: Rate limit uploads to prevent abuse, validate magic bytes
sessionsRoutes.post("/", requireWriteAccess, uploadLimiter, ...uploadMiddleware.single("video"), sessionsController.create);
sessionsRoutes.patch("/:id", requireWriteAccess, sessionsController.update);
sessionsRoutes.delete("/:id", requireWriteAccess, sessionsController.delete);
