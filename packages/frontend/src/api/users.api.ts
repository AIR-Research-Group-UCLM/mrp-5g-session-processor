import { apiClient } from "./client";
import type { UserListItem, CreateUserInput, UpdateUserInput } from "@mrp/shared";

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export async function listUsers(): Promise<UserListItem[]> {
  const response = await apiClient.get<ApiResponse<{ users: UserListItem[] }>>(
    "/users"
  );
  if (!response.data.data) {
    throw new Error(response.data.error ?? "Failed to fetch users");
  }
  return response.data.data.users;
}

export async function createUser(input: CreateUserInput): Promise<UserListItem> {
  const response = await apiClient.post<ApiResponse<{ user: UserListItem }>>(
    "/users",
    input
  );
  if (!response.data.data) {
    throw new Error(response.data.error ?? "Failed to create user");
  }
  return response.data.data.user;
}

export async function updateUser(
  id: string,
  input: UpdateUserInput
): Promise<UserListItem> {
  const response = await apiClient.patch<ApiResponse<{ user: UserListItem }>>(
    `/users/${id}`,
    input
  );
  if (!response.data.data) {
    throw new Error(response.data.error ?? "Failed to update user");
  }
  return response.data.data.user;
}

export async function deleteUser(id: string): Promise<void> {
  const response = await apiClient.delete<ApiResponse<null>>(`/users/${id}`);
  if (!response.data.success) {
    throw new Error(response.data.error ?? "Failed to delete user");
  }
}
