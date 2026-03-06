import axios from "axios";
import type { PatientInquiryPublic } from "@mrp/shared";
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

export async function getPatientInquiryByToken(
  token: string
): Promise<PatientInquiryPublic> {
  const response = await publicClient.get<ApiResponse<PatientInquiryPublic>>(
    `/patient-inquiry/${token}`
  );
  if (!response.data.data) {
    throw new Error(response.data.error ?? "Failed to fetch patient inquiry");
  }
  return response.data.data;
}
