import { apiClient } from "./client";
import type {
  SessionForAssignment,
  SessionAssignmentListItem,
  AssignmentInput,
} from "@mrp/shared";

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export async function getAvailableSessions(
  userId: string
): Promise<SessionForAssignment[]> {
  const response = await apiClient.get<
    ApiResponse<{ sessions: SessionForAssignment[] }>
  >(`/assignments/users/${userId}/available-sessions`);
  if (!response.data.data) {
    throw new Error(response.data.error ?? "Failed to fetch available sessions");
  }
  return response.data.data.sessions;
}

export async function getUserAssignments(
  userId: string
): Promise<SessionAssignmentListItem[]> {
  const response = await apiClient.get<
    ApiResponse<{ assignments: SessionAssignmentListItem[] }>
  >(`/assignments/users/${userId}`);
  if (!response.data.data) {
    throw new Error(response.data.error ?? "Failed to fetch user assignments");
  }
  return response.data.data.assignments;
}

export async function setUserAssignments(
  userId: string,
  assignments: AssignmentInput[]
): Promise<SessionAssignmentListItem[]> {
  const response = await apiClient.put<
    ApiResponse<{ assignments: SessionAssignmentListItem[] }>
  >(`/assignments/users/${userId}`, { assignments });
  if (!response.data.data) {
    throw new Error(response.data.error ?? "Failed to update assignments");
  }
  return response.data.data.assignments;
}
