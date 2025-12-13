import { Router } from "express";
import { searchController } from "../controllers/search.controller.js";
import { requireAuth } from "../middleware/auth.middleware.js";

export const searchRoutes = Router();

searchRoutes.use(requireAuth);

searchRoutes.get("/", searchController.search);
