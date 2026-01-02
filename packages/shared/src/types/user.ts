export type UserRole = "admin" | "user" | "readonly";

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  createdAt: string;
  updatedAt: string;
}

export interface AuthUser extends Omit<User, "createdAt" | "updatedAt"> {}

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface AuthSession {
  id: string;
  userId: string;
  expiresAt: string;
  createdAt: string;
}

export interface CreateUserInput {
  email: string;
  password: string;
  name: string;
  role?: UserRole;
}

export interface UpdateUserInput {
  name?: string;
  email?: string;
  password?: string;
  role?: UserRole;
}

export interface UserListItem {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  createdAt: string;
}
