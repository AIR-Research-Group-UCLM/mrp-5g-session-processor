import type { RequestHandler } from "express";
import { z } from "zod";
import { config } from "../config/index.js";
import { simulatorService } from "../services/simulator/index.js";
import { LANGUAGE_NAMES } from "@mrp/shared";

const voiceSelectionSchema = z.object({
  DOCTOR: z.string().min(1, "Doctor voice is required"),
  PATIENT: z.string().min(1, "Patient voice is required"),
  SPECIALIST: z.string().min(1, "Specialist voice is required"),
});

const createBodySchema = z.object({
  context: z.string().min(10, "Context must be at least 10 characters").max(5000, "Context must not exceed 5000 characters"),
  language: z.string().refine((val) => val in LANGUAGE_NAMES, {
    message: `Invalid language. Allowed: ${Object.keys(LANGUAGE_NAMES).join(", ")}`,
  }),
  voices: voiceSelectionSchema,
  title: z.string().optional(),
  userTags: z.array(z.string()).optional(),
  notes: z.string().optional(),
});

const create: RequestHandler = async (req, res, next) => {
  try {
    const body = createBodySchema.parse(req.body);
    const userId = req.session.userId;
    if (!userId) {
      res.status(401).json({ success: false, error: "Unauthorized" });
      return;
    }

    const result = await simulatorService.startSimulation(userId, body);

    res.status(201).json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

const getStatus: RequestHandler = async (req, res, next) => {
  try {
    const id = req.params.id;
    if (!id) {
      res.status(400).json({ success: false, error: "Missing simulation ID" });
      return;
    }

    const progress = simulatorService.getSimulationProgress(id);

    if (!progress) {
      res.status(404).json({
        success: false,
        error: "Simulation not found",
      });
      return;
    }

    res.json({
      success: true,
      data: progress,
    });
  } catch (error) {
    next(error);
  }
};

const getVoices: RequestHandler = (_req, res) => {
  res.json({
    success: true,
    data: config.simulator.voices,
  });
};

export const simulatorController = {
  create,
  getStatus,
  getVoices,
};
