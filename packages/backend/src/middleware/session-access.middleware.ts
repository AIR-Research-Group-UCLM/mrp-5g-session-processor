import { assignmentService } from "../services/assignment.service.js";
import { createResourceAccessMiddleware } from "./resource-access.middleware.js";

const { requireRead, requireWrite } = createResourceAccessMiddleware({
  paramName: "id",
  notFoundMessage: "Session not found",
  deleteForbiddenMessage: "Only session owner can delete",
  writeForbiddenMessage: "Write access required for this session",
  checkAccess: assignmentService.canUserAccessSession,
});

export const requireSessionReadAccess = requireRead;
export const requireSessionWriteAccess = requireWrite;
