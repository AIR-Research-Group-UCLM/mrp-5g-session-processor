import axios from "axios";
import type { ConsultationSummaryPublic } from "@mrp/shared";
import { basePathNormalized } from "./client";

const publicClient = axios.create({
  baseURL: `${basePathNormalized}/api`,
  headers: {
    "Content-Type": "application/json",
  },
});

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export async function getConsultationSummaryByToken(
  token: string
): Promise<ConsultationSummaryPublic> {
  const response = await publicClient.get<ApiResponse<ConsultationSummaryPublic>>(
    `/consultation-summary/${token}`
  );
  if (!response.data.data) {
    throw new Error(response.data.error ?? "Failed to fetch consultation summary");
  }
  return response.data.data;
}
