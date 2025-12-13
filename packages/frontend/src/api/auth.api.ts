import { apiClient } from "./client";
import type { LoginCredentials, AuthUser } from "@mrp/shared";

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export async function login(credentials: LoginCredentials): Promise<AuthUser> {
  const response = await apiClient.post<ApiResponse<{ user: AuthUser }>>(
    "/auth/login",
    credentials
  );
  if (!response.data.data) {
    throw new Error(response.data.error ?? "Login failed");
  }
  return response.data.data.user;
}

export async function logout(): Promise<void> {
  await apiClient.post("/auth/logout");
}

export async function getMe(): Promise<AuthUser | null> {
  try {
    const response = await apiClient.get<ApiResponse<{ user: AuthUser }>>(
      "/auth/me"
    );
    return response.data.data?.user ?? null;
  } catch {
    return null;
  }
}
