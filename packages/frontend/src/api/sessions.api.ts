import { apiClient } from "./client";
import type {
  SessionListItem,
  SessionWithTranscript,
  MedicalSession,
  ProcessingProgress,
  UpdateSessionInput,
  SearchResult,
  TranscriptionAccuracy,
  StoredConsultationSummary,
} from "@mrp/shared";

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

interface SessionsListData {
  sessions: SessionListItem[];
  total: number;
  page: number;
  pageSize: number;
}

interface ListSessionsParams {
  page?: number;
  pageSize?: number;
  status?: string;
}

export async function listSessions(
  params?: ListSessionsParams
): Promise<SessionsListData> {
  const response = await apiClient.get<ApiResponse<SessionsListData>>(
    "/sessions",
    { params }
  );
  if (!response.data.data) {
    throw new Error(response.data.error ?? "Failed to fetch sessions");
  }
  return response.data.data;
}

export async function getSession(
  id: string
): Promise<{ session: SessionWithTranscript; videoUrl: string | null }> {
  const response = await apiClient.get<
    ApiResponse<{ session: SessionWithTranscript; videoUrl: string | null }>
  >(`/sessions/${id}`);
  if (!response.data.data) {
    throw new Error(response.data.error ?? "Failed to fetch session");
  }
  return response.data.data;
}

export async function getSessionStatus(
  id: string
): Promise<ProcessingProgress> {
  const response = await apiClient.get<
    ApiResponse<{ progress: ProcessingProgress }>
  >(`/sessions/${id}/status`);
  if (!response.data.data) {
    throw new Error(response.data.error ?? "Failed to fetch status");
  }
  return response.data.data.progress;
}

export async function createSession(
  file: File,
  metadata?: { title?: string; userTags?: string[]; notes?: string }
): Promise<MedicalSession> {
  const formData = new FormData();
  formData.append("video", file);
  if (metadata?.title) formData.append("title", metadata.title);
  if (metadata?.userTags)
    formData.append("userTags", JSON.stringify(metadata.userTags));
  if (metadata?.notes) formData.append("notes", metadata.notes);

  const response = await apiClient.post<
    ApiResponse<{ session: MedicalSession }>
  >("/sessions", formData, {
    headers: {
      "Content-Type": "multipart/form-data",
    },
  });
  if (!response.data.data) {
    throw new Error(response.data.error ?? "Failed to create session");
  }
  return response.data.data.session;
}

export async function updateSession(
  id: string,
  data: UpdateSessionInput
): Promise<MedicalSession> {
  const response = await apiClient.patch<
    ApiResponse<{ session: MedicalSession }>
  >(`/sessions/${id}`, data);
  if (!response.data.data) {
    throw new Error(response.data.error ?? "Failed to update session");
  }
  return response.data.data.session;
}

export async function deleteSession(id: string): Promise<void> {
  await apiClient.delete(`/sessions/${id}`);
}

export async function searchSessions(
  query: string,
  limit: number = 20
): Promise<SearchResult[]> {
  const response = await apiClient.get<
    ApiResponse<{ results: SearchResult[]; total: number }>
  >("/search", {
    params: { q: query, limit },
  });
  if (!response.data.data) {
    throw new Error(response.data.error ?? "Search failed");
  }
  return response.data.data.results;
}

export async function getConsultationSummary(
  id: string
): Promise<StoredConsultationSummary | null> {
  const response = await apiClient.get<
    ApiResponse<{ summary: StoredConsultationSummary | null }>
  >(`/sessions/${id}/consultation-summary`);
  return response.data.data?.summary ?? null;
}

export async function generateConsultationSummary(
  id: string
): Promise<StoredConsultationSummary> {
  const response = await apiClient.post<
    ApiResponse<{ summary: StoredConsultationSummary }>
  >(`/sessions/${id}/consultation-summary`);
  if (!response.data.data) {
    throw new Error(response.data.error ?? "Failed to generate consultation summary");
  }
  return response.data.data.summary;
}

export async function createShareToken(
  sessionId: string,
  expiryHours?: number | null,
): Promise<{ token: string; expiresAt: string | null }> {
  const response = await apiClient.post<
    ApiResponse<{ token: string; expiresAt: string | null }>
  >(`/sessions/${sessionId}/consultation-summary/share`, { expiryHours });
  if (!response.data.data) {
    throw new Error(response.data.error ?? "Failed to create share link");
  }
  return response.data.data;
}

export async function revokeShareToken(sessionId: string): Promise<void> {
  await apiClient.delete(`/sessions/${sessionId}/consultation-summary/share`);
}

export async function getSessionAccuracy(
  id: string
): Promise<TranscriptionAccuracy> {
  const response = await apiClient.get<
    ApiResponse<{ accuracy: TranscriptionAccuracy }>
  >(`/sessions/${id}/accuracy`);
  if (!response.data.data) {
    throw new Error(response.data.error ?? "Failed to fetch accuracy");
  }
  return response.data.data.accuracy;
}
