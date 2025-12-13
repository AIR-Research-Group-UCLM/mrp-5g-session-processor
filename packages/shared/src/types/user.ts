export interface User {
  id: string;
  email: string;
  name: string;
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
