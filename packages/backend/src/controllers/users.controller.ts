import type { RequestHandler } from "express";
import { z } from "zod";
import { userService } from "../services/user.service.js";
import { AppError } from "../middleware/error.middleware.js";

const createUserSchema = z.object({
  email: z.string().email("Invalid email format"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  name: z.string().min(1, "Name is required"),
});

const updateUserSchema = z.object({
  name: z.string().min(1, "Name is required").optional(),
  email: z.string().email("Invalid email format").optional(),
  password: z.string().min(8, "Password must be at least 8 characters").optional(),
});

const list: RequestHandler = async (_req, res, next) => {
  try {
    const users = await userService.listAll();
    res.json({ success: true, data: { users } });
  } catch (error) {
    next(error);
  }
};

const create: RequestHandler = async (req, res, next) => {
  try {
    const input = createUserSchema.parse(req.body);

    if (await userService.emailExists(input.email)) {
      throw new AppError(409, "Email already exists");
    }

    const user = await userService.create(input);
    res.status(201).json({ success: true, data: { user } });
  } catch (error) {
    next(error);
  }
};

const update: RequestHandler = async (req, res, next) => {
  try {
    const id = req.params.id!;
    const input = updateUserSchema.parse(req.body);

    if (input.email && (await userService.emailExists(input.email, id))) {
      throw new AppError(409, "Email already exists");
    }

    const user = await userService.update(id, input);
    if (!user) {
      throw new AppError(404, "User not found");
    }

    res.json({ success: true, data: { user } });
  } catch (error) {
    next(error);
  }
};

const deleteUser: RequestHandler = async (req, res, next) => {
  try {
    const id = req.params.id!;
    const result = await userService.delete(id);

    if (result.protected) {
      throw new AppError(403, "Cannot delete protected admin user");
    }

    if (!result.deleted) {
      throw new AppError(404, "User not found");
    }

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
};

export const usersController = { list, create, update, delete: deleteUser };
