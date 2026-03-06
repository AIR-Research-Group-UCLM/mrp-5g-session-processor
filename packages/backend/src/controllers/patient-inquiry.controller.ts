import type { RequestHandler } from "express";
import { getByShareToken } from "../services/patient-inquiry.service.js";
import { AppError } from "../middleware/error.middleware.js";

const TOKEN_REGEX = /^[a-f0-9]{64}$/;

const getByToken: RequestHandler = async (req, res, next) => {
  try {
    const token = req.params.token!;

    if (!TOKEN_REGEX.test(token)) {
      throw new AppError(400, "Invalid token format");
    }

    const result = getByShareToken(token);

    if (!result) {
      throw new AppError(404, "Patient inquiry not found or link has expired");
    }

    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
};

export const patientInquiryController = {
  getByToken,
};
