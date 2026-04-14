import { Router } from "express";
import { authController } from "../controllers/auth.controller.js";
import { requireAuth } from "../middleware/auth.middleware.js";
import { authLimiter } from "../middleware/rate-limit.middleware.js";

export const authRoutes = Router();

// Security: Rate limit login attempts to prevent brute force attacks
authRoutes.post("/login", authLimiter, authController.login);
authRoutes.post("/logout", requireAuth, authController.logout);
authRoutes.get("/me", authController.me);
