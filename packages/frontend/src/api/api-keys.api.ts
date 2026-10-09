import { apiClient } from "./client";
import type { ApiKey, CreateApiKeyInput, CreatedApiKey } from "@mrp/shared";

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export async function listApiKeys(userId: string): Promise<ApiKey[]> {
  const response = await apiClient.get<ApiResponse<{ apiKeys: ApiKey[] }>>(
    `/users/${userId}/api-keys`
  );
  if (!response.data.data) {
    throw new Error(response.data.error ?? "Failed to fetch API keys");
  }
  return response.data.data.apiKeys;
}

export async function createApiKey(
  userId: string,
  input: CreateApiKeyInput
): Promise<CreatedApiKey> {
  const response = await apiClient.post<ApiResponse<CreatedApiKey>>(
    `/users/${userId}/api-keys`,
    input
  );
  if (!response.data.data) {
    throw new Error(response.data.error ?? "Failed to create API key");
  }
  return response.data.data;
}

export async function revokeApiKey(userId: string, keyId: string): Promise<void> {
  const response = await apiClient.delete<ApiResponse<null>>(
    `/users/${userId}/api-keys/${keyId}`
  );
  if (!response.data.success) {
    throw new Error(response.data.error ?? "Failed to revoke API key");
  }
}
