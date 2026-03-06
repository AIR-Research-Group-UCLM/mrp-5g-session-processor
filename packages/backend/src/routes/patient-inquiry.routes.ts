import { Router } from "express";
import { patientInquiryController } from "../controllers/patient-inquiry.controller.js";

export const patientInquiryRoutes = Router();

// Public — no requireAuth
patientInquiryRoutes.get("/:token", patientInquiryController.getByToken);
