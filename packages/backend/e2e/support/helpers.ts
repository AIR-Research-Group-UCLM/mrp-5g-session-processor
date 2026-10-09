import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { expect, inject } from "vitest";
import { ApiClient, login, type UploadFile } from "./api.js";

export type Role = "admin" | "user" | "readonly";

export interface TestUser {
  id: string;
  email: string;
  password: string;
  name: string;
  role: Role;
  client: ApiClient;
}

export const ctx = () => inject("e2e");

export function uniqueEmail(prefix: string): string {
  return `${prefix}-${randomUUID().slice(0, 8)}@e2e.test`;
}

/** Logs in as the seeded, protected root admin. Use sparingly: rate limits are per user. */
export function loginRootAdmin(): Promise<ApiClient> {
  const { rootAdmin } = ctx();
  return login(rootAdmin.email, rootAdmin.password);
}

/**
 * Creates a user through the admin API and logs in as them.
 * Every test file creates its own users so per-user rate limits never collide.
 */
export async function createUser(admin: ApiClient, role: Role, prefix: string = role): Promise<TestUser> {
  const email = uniqueEmail(prefix);
  const password = `pw-${randomUUID()}`;
  const name = `E2E ${prefix}`;

  const created = await admin.post("/users", { email, password, name });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const id = created.body.data.user.id as string;

  if (role !== "user") {
    const updated = await admin.patch(`/users/${id}`, { role });
    expect(updated.status).toBe(200);
  }

  return { id, email, password, name, role, client: await login(email, password) };
}

/** Root admin creates a dedicated admin for the calling test file. */
export async function createFileAdmin(prefix: string): Promise<TestUser> {
  return createUser(await loginRootAdmin(), "admin", `${prefix}-admin`);
}

export async function createApiKey(
  admin: ApiClient,
  userId: string,
  input: { name?: string; expiresInDays?: number | null } = {}
): Promise<{ key: string; id: string }> {
  const response = await admin.post(`/users/${userId}/api-keys`, { name: input.name ?? "e2e key", ...input });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return { key: response.body.data.key, id: response.body.data.apiKey.id };
}

export function audioUpload(overrides: Partial<UploadFile> = {}): UploadFile {
  return { field: "video", path: ctx().fixtures.audioMp3, contentType: "audio/mpeg", ...overrides };
}

export async function uploadSession(
  client: ApiClient,
  fields: Record<string, string | string[]> = {},
  file: UploadFile = audioUpload()
): Promise<string> {
  const response = await client.upload("/sessions", [file], fields);
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return response.body.data.session.id as string;
}

export async function waitFor<T>(
  probe: () => Promise<T | undefined | null | false>,
  { timeoutMs = 60_000, intervalMs = 500, description = "condition" } = {}
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: unknown;
  while (Date.now() < deadline) {
    const result = await probe();
    if (result) return result;
    last = result;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for ${description} (last: ${JSON.stringify(last)})`);
}

/** Polls the status endpoint until processing finishes and returns the final progress. */
export async function waitForProcessing(
  client: ApiClient,
  sessionId: string,
  { timeoutMs = 60_000, intervalMs = 500 } = {}
): Promise<any> {
  return waitFor(
    async () => {
      const response = await client.get(`/sessions/${sessionId}/status`);
      expect(response.status).toBe(200);
      const progress = response.body.data.progress;
      return progress.status === "completed" || progress.status === "failed" ? progress : null;
    },
    { timeoutMs, intervalMs, description: `session ${sessionId} processing` }
  );
}

/** Direct DB access, only for arranging states the API cannot produce (e.g. expired keys). */
export function withDb<T>(fn: (db: Database.Database) => T): T {
  const db = new Database(ctx().databasePath);
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

export interface FakeAiCall {
  kind: string;
  path: string;
  model: string | null;
  axis: string | null;
  at: string;
}

export const fakeAi = {
  async calls(): Promise<FakeAiCall[]> {
    const response = await fetch(`${ctx().fakeAiUrl}/__control/requests`);
    return (await response.json()) as FakeAiCall[];
  },
  async failNext(kind: string, count = 1): Promise<void> {
    await fetch(`${ctx().fakeAiUrl}/__control/fail`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, count }),
    });
  },
};
