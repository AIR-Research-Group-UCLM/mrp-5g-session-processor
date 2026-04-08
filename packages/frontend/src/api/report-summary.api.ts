import { apiClient } from "./client";
import type { StoredReportSummary, ReportSummaryListItem } from "@mrp/shared";

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
): Promise<{ token: string; expiresAt: string }> {
  const response = await apiClient.post<ApiResponse<{ token: string; expiresAt: string }>>(
    `/report-summaries/${summaryId}/share`,
  );
  if (!response.data.data) {
    throw new Error(response.data.error ?? "Failed to create share link");
  }
  return response.data.data;
}

export async function revokeReportShareToken(summaryId: string): Promise<void> {
  await apiClient.delete(`/report-summaries/${summaryId}/share`);
}
