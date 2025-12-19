import type { RequestHandler } from "express";
import { z } from "zod";
import { sessionService } from "../services/session.service.js";
import { s3Service } from "../services/s3.service.js";
import { accuracyService } from "../services/accuracy.service.js";
import { AppError } from "../middleware/error.middleware.js";
import { logger } from "../config/logger.js";

const listQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(20),
  status: z.string().optional(),
  search: z.string().optional(),
});

const updateBodySchema = z.object({
  title: z.string().optional(),
  userTags: z.array(z.string()).optional(),
  notes: z.string().optional(),
});

const createBodySchema = z.object({
  title: z.string().optional(),
  userTags: z.array(z.string()).optional(),
  notes: z.string().optional(),
});

const list: RequestHandler = async (req, res, next) => {
  try {
    const query = listQuerySchema.parse(req.query);
    const userId = req.session.userId!;

    const result = await sessionService.listByUser(userId, query);

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

const create: RequestHandler = async (req, res, next) => {
  try {
    if (!req.file) {
      throw new AppError(400, "Video file is required");
    }

    const body = createBodySchema.parse(req.body);
    const userId = req.session.userId!;

    const session = await sessionService.create(userId, req.file, body);

    res.status(201).json({
      success: true,
      data: { session },
    });
  } catch (error) {
    next(error);
  }
};

const getById: RequestHandler = async (req, res, next) => {
  try {
    const userId = req.session.userId!;
    const sessionId = req.params.id!;

    const result = await sessionService.getByIdWithTranscript(userId, sessionId);

    if (!result) {
      throw new AppError(404, "Session not found");
    }

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

const getStatus: RequestHandler = async (req, res, next) => {
  try {
    const userId = req.session.userId!;
    const sessionId = req.params.id!;

    const progress = await sessionService.getProcessingStatus(userId, sessionId);

    if (!progress) {
      throw new AppError(404, "Session not found");
    }

    res.json({
      success: true,
      data: { progress },
    });
  } catch (error) {
    next(error);
  }
};

const update: RequestHandler = async (req, res, next) => {
  try {
    const userId = req.session.userId!;
    const sessionId = req.params.id!;
    const body = updateBodySchema.parse(req.body);

    const session = await sessionService.update(userId, sessionId, body);

    if (!session) {
      throw new AppError(404, "Session not found");
    }

    res.json({
      success: true,
      data: { session },
    });
  } catch (error) {
    next(error);
  }
};

const deleteSession: RequestHandler = async (req, res, next) => {
  try {
    const userId = req.session.userId!;
    const sessionId = req.params.id!;

    const deleted = await sessionService.delete(userId, sessionId);

    if (!deleted) {
      throw new AppError(404, "Session not found");
    }

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
};

const getVideoUrl: RequestHandler = async (req, res, next) => {
  try {
    const userId = req.session.userId!;
    const sessionId = req.params.id!;

    const url = await sessionService.getVideoUrl(userId, sessionId);

    if (!url) {
      throw new AppError(404, "Video not found");
    }

    res.json({
      success: true,
      data: { url },
    });
  } catch (error) {
    next(error);
  }
};

const streamVideo: RequestHandler = async (req, res, next) => {
  try {
    const userId = req.session.userId!;
    const sessionId = req.params.id!;

    const s3Key = await sessionService.getVideoS3Key(userId, sessionId);
    if (!s3Key) {
      throw new AppError(404, "Video not found");
    }

    const metadata = await s3Service.getFileMetadata(s3Key);
    if (!metadata) {
      throw new AppError(404, "Video file not found in storage");
    }

    const { contentLength, contentType } = metadata;
    const rangeHeader = req.headers.range;

    if (rangeHeader) {
      const parts = rangeHeader.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0]!, 10);
      const end = parts[1] ? parseInt(parts[1], 10) : contentLength - 1;
      const chunkSize = end - start + 1;

      logger.debug({ sessionId, start, end, chunkSize }, "Streaming video range");

      const result = await s3Service.getFileStream(s3Key, { start, end });
      if (!result) {
        throw new AppError(500, "Failed to stream video");
      }

      res.writeHead(206, {
        "Content-Range": `bytes ${start}-${end}/${contentLength}`,
        "Accept-Ranges": "bytes",
        "Content-Length": chunkSize,
        "Content-Type": contentType,
      });

      result.stream.pipe(res);
    } else {
      logger.debug({ sessionId, contentLength }, "Streaming full video");

      const result = await s3Service.getFileStream(s3Key);
      if (!result) {
        throw new AppError(500, "Failed to stream video");
      }

      res.writeHead(200, {
        "Content-Length": contentLength,
        "Content-Type": contentType,
        "Accept-Ranges": "bytes",
      });

      result.stream.pipe(res);
    }
  } catch (error) {
    next(error);
  }
};

const getAccuracy: RequestHandler = async (req, res, next) => {
  try {
    const userId = req.session.userId!;
    const sessionId = req.params.id!;

    const accuracy = await accuracyService.calculateTranscriptionAccuracy(
      sessionId,
      userId
    );

    if (!accuracy) {
      throw new AppError(404, "Session not found");
    }

    res.json({
      success: true,
      data: { accuracy },
    });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Session is not simulated") {
        return next(new AppError(400, error.message));
      }
      if (error.message === "Session processing not completed") {
        return next(new AppError(400, error.message));
      }
      if (
        error.message === "Simulated transcript not found in S3" ||
        error.message === "No transcript sections found"
      ) {
        return next(new AppError(500, error.message));
      }
    }
    next(error);
  }
};

export const sessionsController = {
  list,
  create,
  getById,
  getStatus,
  update,
  delete: deleteSession,
  getVideoUrl,
  streamVideo,
  getAccuracy,
};
