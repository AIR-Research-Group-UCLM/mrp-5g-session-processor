import { Router } from "express";
import { authController } from "../controllers/auth.controller.js";
import { requireAuth } from "../middleware/auth.middleware.js";

export const authRoutes = Router();

authRoutes.post("/login", authController.login);
authRoutes.post("/logout", requireAuth, authController.logout);
authRoutes.get("/me", requireAuth, authController.me);
