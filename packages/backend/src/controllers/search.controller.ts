import type { RequestHandler } from "express";
import { z } from "zod";
import { searchService } from "../services/search.service.js";

const searchQuerySchema = z.object({
  // Security: Limit query length to prevent ReDoS and memory exhaustion
  q: z.string().min(1).max(500),
  limit: z.coerce.number().min(1).max(100).default(20),
});

const search: RequestHandler = async (req, res, next) => {
  try {
    const { q, limit } = searchQuerySchema.parse(req.query);
    const userId = req.session.userId!;

    const results = await searchService.search(userId, q, limit);

    res.json({
      success: true,
      data: {
        results,
        total: results.length,
      },
    });
  } catch (error) {
    next(error);
  }
};

export const searchController = {
  search,
};
