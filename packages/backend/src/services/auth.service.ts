import * as argon2 from "argon2";
import { getDb } from "../db/connection.js";

interface DbUser {
  id: string;
  email: string;
  password_hash: string;
  name: string;
  role: string;
  created_at: string;
  updated_at: string;
}

interface User {
  id: string;
  email: string;
  name: string;
  role: string;
  createdAt: string;
  updatedAt: string;
}

function mapDbUser(row: DbUser): User {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function validateCredentials(
  email: string,
  password: string
): Promise<User | null> {
  const db = getDb();

  const row = db
    .prepare("SELECT * FROM users WHERE email = ?")
    .get(email) as DbUser | undefined;

  if (!row) {
    return null;
  }

  const valid = await argon2.verify(row.password_hash, password);

  if (!valid) {
    return null;
  }

  return mapDbUser(row);
}

async function getUserById(id: string): Promise<User | null> {
  const db = getDb();

  const row = db
    .prepare("SELECT * FROM users WHERE id = ?")
    .get(id) as DbUser | undefined;

  if (!row) {
    return null;
  }

  return mapDbUser(row);
}

async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password);
}

export const authService = {
  validateCredentials,
  getUserById,
  hashPassword,
};
