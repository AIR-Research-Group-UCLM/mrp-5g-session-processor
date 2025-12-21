import { Router } from "express";
import { usersController } from "../controllers/users.controller.js";
import { requireAuth } from "../middleware/auth.middleware.js";
import { requireAdmin } from "../middleware/admin.middleware.js";

export const usersRoutes = Router();

usersRoutes.use(requireAuth);
usersRoutes.use(requireAdmin);

usersRoutes.get("/", usersController.list);
usersRoutes.post("/", usersController.create);
usersRoutes.patch("/:id", usersController.update);
usersRoutes.delete("/:id", usersController.delete);
