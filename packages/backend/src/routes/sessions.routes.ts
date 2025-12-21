import { Router } from "express";
import { sessionsController } from "../controllers/sessions.controller.js";
import { requireAuth } from "../middleware/auth.middleware.js";
import { uploadMiddleware } from "../middleware/upload.middleware.js";
import { uploadLimiter } from "../middleware/rate-limit.middleware.js";

export const sessionsRoutes = Router();

sessionsRoutes.use(requireAuth);

sessionsRoutes.get("/", sessionsController.list);
// Security: Rate limit uploads to prevent abuse, validate magic bytes
sessionsRoutes.post("/", uploadLimiter, ...uploadMiddleware.single("video"), sessionsController.create);
sessionsRoutes.get("/:id", sessionsController.getById);
sessionsRoutes.get("/:id/status", sessionsController.getStatus);
sessionsRoutes.get("/:id/accuracy", sessionsController.getAccuracy);
sessionsRoutes.patch("/:id", sessionsController.update);
sessionsRoutes.delete("/:id", sessionsController.delete);
sessionsRoutes.get("/:id/video", sessionsController.getVideoUrl);
sessionsRoutes.get("/:id/video/stream", sessionsController.streamVideo);
