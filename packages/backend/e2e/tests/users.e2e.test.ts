import { beforeAll, describe, expect, it } from "vitest";
import { login } from "../support/api.js";
import { createApiKey, createFileAdmin, createUser, ctx, uniqueEmail, type TestUser } from "../support/helpers.js";

describe("user management (admin)", () => {
  let admin: TestUser;

  beforeAll(async () => {
    admin = await createFileAdmin("users");
  });

  it("creates a user that can log in", async () => {
    const email = uniqueEmail("created");
    const response = await admin.client.post("/users", { email, password: "password-123", name: "Created User" });

    expect(response.status).toBe(201);
    expect(response.body.data.user).toMatchObject({
      email,
      name: "Created User",
      role: "user",
      activeApiKeyCount: 0,
    });
    expect(response.body.data.user).not.toHaveProperty("password_hash");

    const client = await login(email, "password-123");
    expect((await client.get("/auth/me")).body.data.user.email).toBe(email);
  });

  it("creates a user with the requested role", async () => {
    const response = await admin.client.post("/users", {
      email: uniqueEmail("created-readonly"),
      password: "password-123",
      name: "Readonly On Create",
      role: "readonly",
    });

    expect(response.status).toBe(201);
    expect(response.body.data.user.role).toBe("readonly");
  });

  it("lists users without exposing password hashes", async () => {
    const response = await admin.client.get("/users");

    expect(response.status).toBe(200);
    const emails = response.body.data.users.map((u: { email: string }) => u.email);
    expect(emails).toContain(admin.email);
    expect(emails).toContain(ctx().rootAdmin.email);
    for (const user of response.body.data.users) {
      expect(Object.keys(user).sort()).toEqual(["activeApiKeyCount", "createdAt", "email", "id", "name", "role"]);
    }
  });

  it("validates the create payload", async () => {
    const invalid = [
      { email: "not-an-email", password: "password-123", name: "X" },
      { email: uniqueEmail("short"), password: "short", name: "X" },
      { email: uniqueEmail("noname"), password: "password-123", name: "" },
    ];
    for (const body of invalid) {
      const response = await admin.client.post("/users", body);
      expect(response.status, JSON.stringify(body)).toBe(400);
    }
  });

  it("rejects duplicate emails on create and update", async () => {
    const existing = await createUser(admin.client, "user", "dup");
    const create = await admin.client.post("/users", { email: existing.email, password: "password-123", name: "Dup" });
    expect(create.status).toBe(409);

    const other = await createUser(admin.client, "user", "dup-other");
    const update = await admin.client.patch(`/users/${other.id}`, { email: existing.email });
    expect(update.status).toBe(409);
  });

  it("updates name, email, password and role", async () => {
    const target = await createUser(admin.client, "user", "update");
    const newEmail = uniqueEmail("updated");

    const response = await admin.client.patch(`/users/${target.id}`, {
      name: "Updated Name",
      email: newEmail,
      password: "new-password-123",
      role: "readonly",
    });

    expect(response.status).toBe(200);
    expect(response.body.data.user).toMatchObject({ id: target.id, name: "Updated Name", email: newEmail, role: "readonly" });

    await expect(login(target.email, target.password)).rejects.toThrow(/401/);
    const relogged = await login(newEmail, "new-password-123");
    expect((await relogged.get("/auth/me")).body.data.user.role).toBe("readonly");
  });

  it("returns 404 when updating or deleting an unknown user", async () => {
    const unknownId = "00000000-0000-4000-8000-00000000dead";
    expect((await admin.client.patch(`/users/${unknownId}`, { name: "X" })).status).toBe(404);
    expect((await admin.client.delete(`/users/${unknownId}`)).status).toBe(404);
  });

  it("deletes a user, which revokes their credentials and API keys", async () => {
    const target = await createUser(admin.client, "user", "delete");
    const { key } = await createApiKey(admin.client, target.id);
    expect((await target.client.withBearer(key).get("/sessions")).status).toBe(200);

    const response = await admin.client.delete(`/users/${target.id}`);
    expect(response.status).toBe(200);

    expect((await target.client.withBearer(key).get("/sessions")).status).toBe(401);
    await expect(login(target.email, target.password)).rejects.toThrow(/401/);
    const users = (await admin.client.get("/users")).body.data.users;
    expect(users.find((u: { id: string }) => u.id === target.id)).toBeUndefined();
  });

  it("protects the root admin from deletion and role changes", async () => {
    const users = (await admin.client.get("/users")).body.data.users;
    const root = users.find((u: { email: string }) => u.email === ctx().rootAdmin.email);

    expect((await admin.client.delete(`/users/${root.id}`)).status).toBe(403);

    const update = await admin.client.patch(`/users/${root.id}`, { role: "readonly" });
    expect(update.status).toBe(200);
    expect(update.body.data.user.role).toBe("admin");
  });
});

describe("user management access control", () => {
  it("rejects non-admin roles with 403", async () => {
    const admin = await createFileAdmin("users-rbac");
    const user = await createUser(admin.client, "user", "users-rbac-user");
    const readonly = await createUser(admin.client, "readonly", "users-rbac-ro");

    for (const client of [user.client, readonly.client]) {
      expect((await client.get("/users")).status).toBe(403);
      expect((await client.post("/users", { email: uniqueEmail("x"), password: "password-123", name: "X" })).status).toBe(403);
      expect((await client.patch(`/users/${user.id}`, { role: "admin" })).status).toBe(403);
      expect((await client.delete(`/users/${admin.id}`)).status).toBe(403);
    }
  });
});
