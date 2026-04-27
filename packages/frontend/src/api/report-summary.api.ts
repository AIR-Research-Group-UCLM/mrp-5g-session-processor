import { apiClient } from "./client";
import type {
  StoredReportSummary,
  ReportSummaryListItem,
  ConsultationSummaryPublic,
} from "@mrp/shared";

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

interface ReportSummaryListData {
  summaries: ReportSummaryListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export async function generateReportSummary(
  reportText: string,
  title?: string,
): Promise<StoredReportSummary> {
  const response = await apiClient.post<ApiResponse<{ summary: StoredReportSummary }>>(
    "/report-summaries",
    { reportText, title },
  );
  if (!response.data.data) {
    throw new Error(response.data.error ?? "Failed to generate report summary");
  }
  return response.data.data.summary;
}

export async function listReportSummaries(
  params?: { page?: number; pageSize?: number },
): Promise<ReportSummaryListData> {
  const response = await apiClient.get<ApiResponse<ReportSummaryListData>>(
    "/report-summaries",
    { params },
  );
  if (!response.data.data) {
    throw new Error(response.data.error ?? "Failed to fetch report summaries");
  }
  return response.data.data;
}

export async function getReportSummary(id: string): Promise<StoredReportSummary> {
  const response = await apiClient.get<ApiResponse<{ summary: StoredReportSummary }>>(
    `/report-summaries/${id}`,
  );
  if (!response.data.data) {
    throw new Error(response.data.error ?? "Failed to fetch report summary");
  }
  return response.data.data.summary;
}

export async function deleteReportSummary(id: string): Promise<void> {
  await apiClient.delete(`/report-summaries/${id}`);
}

export async function createReportShareToken(
  summaryId: string,
  expiryHours?: number | null,
): Promise<{ token: string; expiresAt: string | null }> {
  const response = await apiClient.post<ApiResponse<{ token: string; expiresAt: string | null }>>(
    `/report-summaries/${summaryId}/share`,
    { expiryHours },
  );
  if (!response.data.data) {
    throw new Error(response.data.error ?? "Failed to create share link");
  }
  return response.data.data;
}

export async function revokeReportShareToken(summaryId: string): Promise<void> {
  await apiClient.delete(`/report-summaries/${summaryId}/share`);
}

export async function confirmReportSummary(
  summaryId: string,
): Promise<StoredReportSummary> {
  const response = await apiClient.post<ApiResponse<{ summary: StoredReportSummary }>>(
    `/report-summaries/${summaryId}/confirm`,
  );
  if (!response.data.data) {
    throw new Error(response.data.error ?? "Failed to confirm report summary");
  }
  return response.data.data.summary;
}

export async function unconfirmReportSummary(
  summaryId: string,
): Promise<StoredReportSummary> {
  const response = await apiClient.delete<ApiResponse<{ summary: StoredReportSummary }>>(
    `/report-summaries/${summaryId}/confirm`,
  );
  if (!response.data.data) {
    throw new Error(response.data.error ?? "Failed to unconfirm report summary");
  }
  return response.data.data.summary;
}

export async function revalidateReportSummary(
  summaryId: string,
): Promise<StoredReportSummary> {
  const response = await apiClient.post<ApiResponse<{ summary: StoredReportSummary }>>(
    `/report-summaries/${summaryId}/revalidate`,
  );
  if (!response.data.data) {
    throw new Error(response.data.error ?? "Failed to revalidate report summary");
  }
  return response.data.data.summary;
}

export async function getReportSummaryPatientView(
  summaryId: string,
): Promise<ConsultationSummaryPublic> {
  const response = await apiClient.get<ApiResponse<ConsultationSummaryPublic>>(
    `/report-summaries/${summaryId}/patient-view`,
  );
  if (!response.data.data) {
    throw new Error(response.data.error ?? "Failed to fetch patient view");
  }
  return response.data.data;
}

export async function extractTextFromFile(
  file: File,
): Promise<{ text: string; filename: string }> {
  const formData = new FormData();
  formData.append("file", file);

  const response = await apiClient.post<
    ApiResponse<{ text: string; filename: string }>
  >("/report-summaries/extract-text", formData, {
    headers: {
      "Content-Type": "multipart/form-data",
    },
  });

  if (!response.data.data) {
    throw new Error(response.data.error ?? "Failed to extract text from file");
  }
  return response.data.data;
}
