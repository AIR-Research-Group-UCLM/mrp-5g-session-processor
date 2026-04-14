import type { RequestHandler } from "express";
import { z } from "zod";
import {
  generateReportSummary as generateReportSummaryService,
  listReportSummaries as listReportSummariesService,
  getReportSummary as getReportSummaryService,
  deleteReportSummary as deleteReportSummaryService,
  createShareToken as createShareTokenService,
  revokeShareToken as revokeShareTokenService,
} from "../services/report-summary.service.js";
import { AppError } from "../middleware/error.middleware.js";

const generateBodySchema = z.object({
  reportText: z.string().min(50).max(50000),
  title: z.string().max(200).optional(),
});

const listQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(20),
});

const generate: RequestHandler = async (req, res, next) => {
  try {
    const body = generateBodySchema.parse(req.body);
    const userId = req.session.userId!;

    const summary = await generateReportSummaryService(
      userId,
      body.reportText,
      body.title ?? null,
    );

    res.status(201).json({ success: true, data: { summary } });
  } catch (error) {
    next(error);
  }
};

const list: RequestHandler = async (req, res, next) => {
  try {
    const query = listQuerySchema.parse(req.query);
    const userId = req.session.userId!;

    const result = listReportSummariesService(userId, query.page, query.pageSize);

    res.json({
      success: true,
      data: {
        summaries: result.summaries,
        total: result.total,
        page: query.page,
        pageSize: query.pageSize,
      },
    });
  } catch (error) {
    next(error);
  }
};

const getById: RequestHandler = async (req, res, next) => {
  try {
    const id = req.params.id!;
    const userId = req.session.userId!;

    const summary = getReportSummaryService(id, userId);

    if (!summary) {
      throw new AppError(404, "Report summary not found");
    }

    res.json({ success: true, data: { summary } });
  } catch (error) {
    next(error);
  }
};

const remove: RequestHandler = async (req, res, next) => {
  try {
    const id = req.params.id!;
    const userId = req.session.userId!;

    const deleted = deleteReportSummaryService(id, userId);

    if (!deleted) {
      throw new AppError(404, "Report summary not found");
    }

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
};

const shareBodySchema = z.object({
  expiryHours: z.number().positive().nullable().optional(),
});

const createShareToken: RequestHandler = async (req, res, next) => {
  try {
    const id = req.params.id!;
    const userId = req.session.userId!;
    const body = shareBodySchema.parse(req.body);

    const result = createShareTokenService(id, userId, body.expiryHours);

    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
};

const revokeShareToken: RequestHandler = async (req, res, next) => {
  try {
    const id = req.params.id!;
    const userId = req.session.userId!;

    revokeShareTokenService(id, userId);

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
};

export const reportSummaryController = {
  generate,
  list,
  getById,
  remove,
  createShareToken,
  revokeShareToken,
};
