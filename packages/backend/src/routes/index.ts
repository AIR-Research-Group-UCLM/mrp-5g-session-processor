import { Router } from "express";
import { authRoutes } from "./auth.routes.js";
import { sessionsRoutes } from "./sessions.routes.js";
import { searchRoutes } from "./search.routes.js";

export const routes = Router();

routes.use("/auth", authRoutes);
routes.use("/sessions", sessionsRoutes);
routes.use("/search", searchRoutes);
