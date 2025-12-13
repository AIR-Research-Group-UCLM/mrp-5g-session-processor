import { Router } from "express";
import { sessionsController } from "../controllers/sessions.controller.js";
import { requireAuth } from "../middleware/auth.middleware.js";
import { uploadMiddleware } from "../middleware/upload.middleware.js";

export const sessionsRoutes = Router();

sessionsRoutes.use(requireAuth);

sessionsRoutes.get("/", sessionsController.list);
sessionsRoutes.post("/", uploadMiddleware.single("video"), sessionsController.create);
sessionsRoutes.get("/:id", sessionsController.getById);
sessionsRoutes.get("/:id/status", sessionsController.getStatus);
sessionsRoutes.patch("/:id", sessionsController.update);
sessionsRoutes.delete("/:id", sessionsController.delete);
sessionsRoutes.get("/:id/video", sessionsController.getVideoUrl);
sessionsRoutes.get("/:id/video/stream", sessionsController.streamVideo);
