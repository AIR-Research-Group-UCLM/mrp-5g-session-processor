import { Router } from "express";
import { assignmentsController } from "../controllers/assignments.controller.js";
import { requireAuth } from "../middleware/auth.middleware.js";
import { requireAdmin } from "../middleware/admin.middleware.js";

export const assignmentsRoutes = Router();

// All assignment operations require admin access
assignmentsRoutes.use(requireAuth);
assignmentsRoutes.use(requireAdmin);

// Get sessions available for assignment to a user
assignmentsRoutes.get(
  "/users/:userId/available-sessions",
  assignmentsController.getAvailableSessions
);

// Get/Set assignments for a user
assignmentsRoutes.get("/users/:userId", assignmentsController.getUserAssignments);
assignmentsRoutes.put("/users/:userId", assignmentsController.setUserAssignments);

// Report-summary assignments (parallel surface to the session ones above)
assignmentsRoutes.get(
  "/users/:userId/available-report-summaries",
  assignmentsController.getAvailableReportSummaries
);
assignmentsRoutes.get(
  "/users/:userId/report-summaries",
  assignmentsController.getUserReportSummaryAssignments
);
assignmentsRoutes.put(
  "/users/:userId/report-summaries",
  assignmentsController.setUserReportSummaryAssignments
);
