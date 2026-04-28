import { assignmentService } from "../services/assignment.service.js";
import { createResourceAccessMiddleware } from "./resource-access.middleware.js";

const { requireRead, requireWrite } = createResourceAccessMiddleware({
  paramName: "id",
  notFoundMessage: "Report summary not found",
  deleteForbiddenMessage: "Only report owner can delete",
  writeForbiddenMessage: "Write access required for this report",
  checkAccess: assignmentService.canUserAccessReportSummary,
});

export const requireReportSummaryReadAccess = requireRead;
export const requireReportSummaryWriteAccess = requireWrite;
