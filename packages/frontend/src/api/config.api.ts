import { apiClient } from "./client";
import type { AppConfig } from "@mrp/shared";

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export async function getAppConfig(): Promise<AppConfig> {
  const response = await apiClient.get<ApiResponse<AppConfig>>("/config");
  if (!response.data.data) {
    throw new Error(response.data.error ?? "Failed to fetch app config");
  }
  return response.data.data;
}
