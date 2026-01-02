import { Router } from "express";
import { authRoutes } from "./auth.routes.js";
import { sessionsRoutes } from "./sessions.routes.js";
import { searchRoutes } from "./search.routes.js";
import { simulatorRoutes } from "./simulator.routes.js";
import { usersRoutes } from "./users.routes.js";
import { assignmentsRoutes } from "./assignments.routes.js";

export const routes = Router();

routes.use("/auth", authRoutes);
routes.use("/sessions", sessionsRoutes);
routes.use("/search", searchRoutes);
routes.use("/simulator", simulatorRoutes);
routes.use("/users", usersRoutes);
routes.use("/assignments", assignmentsRoutes);
