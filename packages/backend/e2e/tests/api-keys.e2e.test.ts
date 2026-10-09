import { beforeAll, describe, expect, it } from "vitest";
import { ApiClient } from "../support/api.js";
import { createApiKey, createFileAdmin, createUser, uniqueEmail, withDb, type TestUser } from "../support/helpers.js";

describe("API key management (admin)", () => {
  let admin: TestUser;
  let user: TestUser;

  beforeAll(async () => {
    admin = await createFileAdmin("keys");
    user = await createUser(admin.client, "user", "keys-user");
  });

  it("creates a key, returning the plaintext only once", async () => {
    const response = await admin.client.post(`/users/${user.id}/api-keys`, { name: "  HIS integration  " });

    expect(response.status).toBe(201);
    const { apiKey, key } = response.body.data;
    expect(key).toMatch(/^mrp_[A-Za-z0-9_-]{43}$/);
    expect(apiKey).toMatchObject({
      userId: user.id,
      name: "HIS integration",
      keyPrefix: key.slice(0, 12),
      expiresAt: null,
      lastUsedAt: null,
      revokedAt: null,
    });

    const list = await admin.client.get(`/users/${user.id}/api-keys`);
    expect(list.status).toBe(200);
    const listed = list.body.data.apiKeys.find((k: { id: string }) => k.id === apiKey.id);
    expect(listed).toEqual(apiKey);
    expect(JSON.stringify(list.body)).not.toContain(key);
  });

  it("stores only a SHA-256 hash of the key", async () => {
    const { key, id } = await createApiKey(admin.client, user.id);
    const row = withDb((db) => db.prepare("SELECT * FROM api_keys WHERE id = ?").get(id)) as Record<string, string>;

    expect(row.key_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(Object.values(row)).not.toContain(key);
  });

  it("sets an expiry date when expiresInDays is provided", async () => {
    const before = Date.now();
    const response = await admin.client.post(`/users/${user.id}/api-keys`, { name: "expiring", expiresInDays: 30 });

    expect(response.status).toBe(201);
    const expiresAt = new Date(response.body.data.apiKey.expiresAt).getTime();
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;
    expect(expiresAt).toBeGreaterThanOrEqual(before + thirtyDays);
    expect(expiresAt).toBeLessThanOrEqual(Date.now() + thirtyDays);
  });

  it("validates the create payload", async () => {
    const invalid = [{}, { name: "   " }, { name: "x".repeat(101) }, { name: "x", expiresInDays: 0 }, { name: "x", expiresInDays: 1.5 }];
    for (const body of invalid) {
      const response = await admin.client.post(`/users/${user.id}/api-keys`, body);
      expect(response.status, JSON.stringify(body)).toBe(400);
    }
  });

  it("returns 404 when creating a key for an unknown user", async () => {
    const response = await admin.client.post("/users/00000000-0000-4000-8000-00000000dead/api-keys", { name: "x" });
    expect(response.status).toBe(404);
  });

  it("revokes a key so it stops working immediately", async () => {
    const { key, id } = await createApiKey(admin.client, user.id);
    const client = ApiClient.anonymous().withBearer(key);
    expect((await client.get("/sessions")).status).toBe(200);

    const revoke = await admin.client.delete(`/users/${user.id}/api-keys/${id}`);
    expect(revoke.status).toBe(200);

    const rejected = await client.get("/sessions");
    expect(rejected.status).toBe(401);
    expect(rejected.body.error).toBe("Invalid or expired API key");

    const listed = (await admin.client.get(`/users/${user.id}/api-keys`)).body.data.apiKeys.find(
      (k: { id: string }) => k.id === id
    );
    expect(listed.revokedAt).not.toBeNull();

    // Revoking twice, or through another user's path, is a 404
    expect((await admin.client.delete(`/users/${user.id}/api-keys/${id}`)).status).toBe(404);
    const other = await createApiKey(admin.client, admin.id);
    expect((await admin.client.delete(`/users/${user.id}/api-keys/${other.id}`)).status).toBe(404);
  });

  it("counts only active keys per user", async () => {
    const target = await createUser(admin.client, "user", "keys-count");
    const active = await createApiKey(admin.client, target.id);
    const revoked = await createApiKey(admin.client, target.id);
    const expired = await createApiKey(admin.client, target.id);
    await admin.client.delete(`/users/${target.id}/api-keys/${revoked.id}`);
    withDb((db) =>
      db.prepare("UPDATE api_keys SET expires_at = '2020-01-01T00:00:00.000Z' WHERE id = ?").run(expired.id)
    );

    const users = (await admin.client.get("/users")).body.data.users;
    expect(users.find((u: { id: string }) => u.id === target.id).activeApiKeyCount).toBe(1);
    expect(active.key).toBeTruthy();
  });

  it("is restricted to admins", async () => {
    const regular = await createUser(admin.client, "user", "keys-rbac");
    expect((await regular.client.get(`/users/${regular.id}/api-keys`)).status).toBe(403);
    expect((await regular.client.post(`/users/${regular.id}/api-keys`, { name: "self-issued" })).status).toBe(403);
  });
});

describe("API key authentication", () => {
  let admin: TestUser;
  let user: TestUser;
  let key: string;

  beforeAll(async () => {
    admin = await createFileAdmin("keyauth");
    user = await createUser(admin.client, "user", "keyauth-user");
    key = (await createApiKey(admin.client, user.id)).key;
  });

  it("authenticates with Authorization: Bearer", async () => {
    const response = await ApiClient.anonymous().withBearer(key).get("/auth/me");
    expect(response.status).toBe(200);
    expect(response.body.data.user).toMatchObject({ id: user.id, email: user.email, role: "user" });
  });

  it("authenticates with X-API-Key", async () => {
    const response = await ApiClient.anonymous().withXApiKey(key).get("/auth/me");
    expect(response.body.data.user.id).toBe(user.id);
  });

  it("accepts a case-insensitive bearer scheme", async () => {
    const response = await ApiClient.anonymous().get("/auth/me", { headers: { Authorization: `bearer ${key}` } });
    expect(response.body.data.user.id).toBe(user.id);
  });

  it("does not create a server session or set cookies", async () => {
    const response = await ApiClient.anonymous().withBearer(key).get("/sessions");
    expect(response.status).toBe(200);
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it("rejects unknown, malformed and empty keys with 401", async () => {
    for (const bad of ["mrp_unknown", "not-even-prefixed", `${key}x`]) {
      const response = await ApiClient.anonymous().withXApiKey(bad).get("/sessions");
      expect(response.status, bad).toBe(401);
      expect(response.body.error).toBe("Invalid or expired API key");
    }
  });

  it("never falls back to the session cookie when an invalid key is sent", async () => {
    const response = await user.client.get("/sessions", { headers: { "X-API-Key": "mrp_invalid" } });
    expect(response.status).toBe(401);
  });

  it("takes precedence over the session cookie", async () => {
    const response = await admin.client.get("/auth/me", { headers: { "X-API-Key": key } });
    expect(response.body.data.user.id).toBe(user.id);
  });

  it("rejects expired keys", async () => {
    const expiring = await createApiKey(admin.client, user.id, { expiresInDays: 1 });
    const client = ApiClient.anonymous().withBearer(expiring.key);
    expect((await client.get("/sessions")).status).toBe(200);

    withDb((db) =>
      db.prepare("UPDATE api_keys SET expires_at = '2020-01-01T00:00:00.000Z' WHERE id = ?").run(expiring.id)
    );
    expect((await client.get("/sessions")).status).toBe(401);
  });

  it("records the last time a key was used", async () => {
    const fresh = await createApiKey(admin.client, user.id);
    await ApiClient.anonymous().withBearer(fresh.key).get("/sessions");

    const listed = (await admin.client.get(`/users/${user.id}/api-keys`)).body.data.apiKeys.find(
      (k: { id: string }) => k.id === fresh.id
    );
    expect(listed.lastUsedAt).not.toBeNull();
  });

  it("acts with the role of the key owner", async () => {
    const readonly = await createUser(admin.client, "readonly", "keyauth-ro");
    const roKey = (await createApiKey(admin.client, readonly.id)).key;
    const client = ApiClient.anonymous().withBearer(roKey);

    expect((await client.get("/sessions")).status).toBe(200);
    expect((await client.post("/report-summaries", { reportText: "x".repeat(60) })).status).toBe(403);
    expect((await client.upload("/sessions", [])).status).toBe(403);
    expect((await client.post("/simulator/context-suggestion", { language: "es" })).status).toBe(403);
  });

  it("cannot reach admin endpoints, even when owned by an admin", async () => {
    const adminKey = (await createApiKey(admin.client, admin.id)).key;
    const client = ApiClient.anonymous().withBearer(adminKey);

    const forbidden: Array<[string, string, unknown?]> = [
      ["GET", "/users"],
      ["POST", "/users", { email: uniqueEmail("x"), password: "password-123", name: "X" }],
      ["PATCH", `/users/${user.id}`, { role: "admin" }],
      ["DELETE", `/users/${user.id}`],
      ["GET", `/users/${user.id}/api-keys`],
      ["POST", `/users/${user.id}/api-keys`, { name: "escalation" }],
      ["GET", `/assignments/users/${user.id}`],
      ["PUT", `/assignments/users/${user.id}`, { assignments: [] }],
      ["GET", `/assignments/users/${user.id}/available-sessions`],
      ["GET", `/assignments/users/${user.id}/report-summaries`],
    ];
    for (const [method, path, json] of forbidden) {
      const response = await client.request(method, path, { json });
      expect(response.status, `${method} ${path}`).toBe(403);
      expect(response.body.error).toBe("Admin endpoints are not available with API key authentication");
    }

    // The same admin key works on regular endpoints
    expect((await client.get("/sessions")).status).toBe(200);
  });
});
