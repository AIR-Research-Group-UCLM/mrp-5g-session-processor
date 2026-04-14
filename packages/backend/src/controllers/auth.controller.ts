import type { RequestHandler } from "express";
import { z } from "zod";
import { authService } from "../services/auth.service.js";
import { AppError } from "../middleware/error.middleware.js";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const login: RequestHandler = async (req, res, next) => {
  try {
    const { email, password } = loginSchema.parse(req.body);

    const user = await authService.validateCredentials(email, password);

    if (!user) {
      throw new AppError(401, "Invalid email or password");
    }

    req.session.userId = user.id;

    // Explicitly save session to Redis before responding
    req.session.save((err) => {
      if (err) {
        return next(err);
      }
      res.json({
        success: true,
        data: {
          user: {
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
          },
        },
      });
    });
  } catch (error) {
    next(error);
  }
};

const logout: RequestHandler = (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("connect.sid");
    res.json({ success: true });
  });
};

const me: RequestHandler = async (req, res, next) => {
  try {
    if (!req.session.userId) {
      res.json({ success: true, data: { user: null } });
      return;
    }

    const user = await authService.getUserById(req.session.userId);

    if (!user) {
      throw new AppError(401, "User not found");
    }

    res.json({
      success: true,
      data: {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

export const authController = {
  login,
  logout,
  me,
};
