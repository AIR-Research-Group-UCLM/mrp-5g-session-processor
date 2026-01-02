import * as argon2 from "argon2";
import { v4 as uuidv4 } from "uuid";
import { getDb } from "../db/connection.js";
import type {
  CreateUserInput,
  UpdateUserInput,
  UserListItem,
  UserRole,
} from "@mrp/shared";

interface DbUser {
  id: string;
  email: string;
  password_hash: string;
  name: string;
  role: string;
  created_at: string;
  updated_at: string;
}

const PROTECTED_EMAIL = "admin@user.com";

function mapDbUserToListItem(row: DbUser): UserListItem {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role as UserRole,
    createdAt: row.created_at,
  };
}

async function listAll(): Promise<UserListItem[]> {
  const db = getDb();
  const rows = db
    .prepare(
      "SELECT id, email, name, role, created_at FROM users ORDER BY created_at DESC"
    )
    .all() as DbUser[];
  return rows.map(mapDbUserToListItem);
}

async function create(input: CreateUserInput): Promise<UserListItem> {
  const db = getDb();
  const id = uuidv4();
  const passwordHash = await argon2.hash(input.password);
  const now = new Date().toISOString();
  const role = input.role || "user";

  db.prepare(`
    INSERT INTO users (id, email, password_hash, name, role, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, input.email, passwordHash, input.name, role, now, now);

  return { id, email: input.email, name: input.name, role, createdAt: now };
}

async function update(id: string, input: UpdateUserInput): Promise<UserListItem | null> {
  const db = getDb();
  const existing = db.prepare("SELECT * FROM users WHERE id = ?").get(id) as DbUser | undefined;

  if (!existing) {
    return null;
  }

  const updates: string[] = [];
  const params: string[] = [];

  if (input.name) {
    updates.push("name = ?");
    params.push(input.name);
  }

  if (input.email && input.email !== existing.email) {
    updates.push("email = ?");
    params.push(input.email);
  }

  if (input.password) {
    updates.push("password_hash = ?");
    params.push(await argon2.hash(input.password));
  }

  // Allow role changes except for protected admin account
  if (input.role && input.role !== existing.role && existing.email !== PROTECTED_EMAIL) {
    updates.push("role = ?");
    params.push(input.role);
  }

  if (updates.length === 0) {
    return mapDbUserToListItem(existing);
  }

  updates.push("updated_at = ?");
  params.push(new Date().toISOString());
  params.push(id);

  db.prepare(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`).run(...params);

  const updated = db.prepare("SELECT * FROM users WHERE id = ?").get(id) as DbUser;
  return mapDbUserToListItem(updated);
}

async function deleteUser(id: string): Promise<{ deleted: boolean; protected?: boolean }> {
  const db = getDb();
  const user = db.prepare("SELECT email FROM users WHERE id = ?").get(id) as { email: string } | undefined;

  if (!user) {
    return { deleted: false };
  }

  if (user.email === PROTECTED_EMAIL) {
    return { deleted: false, protected: true };
  }

  const result = db.prepare("DELETE FROM users WHERE id = ?").run(id);
  return { deleted: result.changes > 0 };
}

async function emailExists(email: string, excludeUserId?: string): Promise<boolean> {
  const db = getDb();
  if (excludeUserId) {
    const row = db.prepare("SELECT 1 FROM users WHERE email = ? AND id != ?").get(email, excludeUserId);
    return !!row;
  }
  const row = db.prepare("SELECT 1 FROM users WHERE email = ?").get(email);
  return !!row;
}

export const userService = {
  listAll,
  create,
  update,
  delete: deleteUser,
  emailExists,
};
