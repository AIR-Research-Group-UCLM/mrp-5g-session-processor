import { beforeAll, describe, expect, it } from "vitest";
import { ApiClient, login, uniqueIp } from "../support/api.js";
import { createFileAdmin, createUser, ctx, type TestUser } from "../support/helpers.js";

describe("health", () => {
  it("responds on /health without authentication", async () => {
    const response = await fetch(`${ctx().baseUrl}/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });
});

describe("cookie authentication", () => {
  let admin: TestUser;
  let user: TestUser;

  beforeAll(async () => {
    admin = await createFileAdmin("auth");
    user = await createUser(admin.client, "user", "auth-user");
  });

  it("logs in with valid credentials and returns the user", async () => {
    const response = await ApiClient.anonymous().post(
      "/auth/login",
      { email: user.email, password: user.password },
      { headers: { "X-Forwarded-For": uniqueIp() } }
    );

    expect(response.status).toBe(200);
    expect(response.body.data.user).toEqual({
      id: user.id,
      email: user.email,
      name: user.name,
      role: "user",
    });
    expect(response.headers.getSetCookie().some((c) => c.startsWith("connect.sid="))).toBe(true);
  });

  it("rejects a wrong password with 401", async () => {
    const response = await ApiClient.anonymous().post(
      "/auth/login",
      { email: user.email, password: "wrong-password" },
      { headers: { "X-Forwarded-For": uniqueIp() } }
    );
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ success: false, error: "Invalid email or password" });
  });

  it("rejects an unknown email with the same 401 message", async () => {
    const response = await ApiClient.anonymous().post(
      "/auth/login",
      { email: "nobody@e2e.test", password: "whatever" },
      { headers: { "X-Forwarded-For": uniqueIp() } }
    );
    expect(response.status).toBe(401);
    expect(response.body.error).toBe("Invalid email or password");
  });

  it("validates the login body", async () => {
    const response = await ApiClient.anonymous().post(
      "/auth/login",
      { email: "not-an-email" },
      { headers: { "X-Forwarded-For": uniqueIp() } }
    );
    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Validation error");
  });

  it("returns a null user from /auth/me when anonymous", async () => {
    const response = await ApiClient.anonymous().get("/auth/me");
    expect(response.status).toBe(200);
    expect(response.body.data.user).toBeNull();
  });

  it("returns the current user from /auth/me with a session cookie", async () => {
    const response = await user.client.get("/auth/me");
    expect(response.status).toBe(200);
    expect(response.body.data.user.email).toBe(user.email);
  });

  it("rejects protected endpoints without credentials", async () => {
    for (const path of ["/sessions", "/report-summaries", "/search?q=x", "/simulator/voices", "/users"]) {
      const response = await ApiClient.anonymous().get(path);
      expect(response.status, path).toBe(401);
      expect(response.body.error).toBe("Authentication required");
    }
  });

  it("rejects a forged session cookie", async () => {
    const forged = ApiClient.anonymous().withCookie("connect.sid=s%3Aforged.signature");
    expect((await forged.get("/sessions")).status).toBe(401);
  });

  it("invalidates the session on logout", async () => {
    const client = await login(user.email, user.password);
    expect((await client.get("/sessions")).status).toBe(200);

    const logout = await client.post("/auth/logout");
    expect(logout.status).toBe(200);

    expect((await client.get("/sessions")).status).toBe(401);
    expect((await client.get("/auth/me")).body.data.user).toBeNull();
  });
});

describe("rate limits", () => {
  it("blocks the 6th login attempt from the same IP within 15 minutes", async () => {
    const ip = uniqueIp();
    const attempt = () =>
      ApiClient.anonymous().post(
        "/auth/login",
        { email: "nobody@e2e.test", password: "wrong" },
        { headers: { "X-Forwarded-For": ip } }
      );

    for (let i = 0; i < 5; i++) {
      expect((await attempt()).status).toBe(401);
    }
    const blocked = await attempt();
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toMatch(/Too many login attempts/);

    // A different IP is not affected
    const other = await ApiClient.anonymous().post(
      "/auth/login",
      { email: "nobody@e2e.test", password: "wrong" },
      { headers: { "X-Forwarded-For": uniqueIp() } }
    );
    expect(other.status).toBe(401);
  });

  it("limits each user to 100 API requests per minute", async () => {
    const admin = await createFileAdmin("ratelimit");
    const user = await createUser(admin.client, "user", "ratelimit-user");

    // Login is not part of the per-user budget; count only authenticated calls
    const statuses: number[] = [];
    for (let i = 0; i < 101; i++) {
      statuses.push((await user.client.get("/auth/me")).status);
    }

    expect(statuses.slice(0, 100).every((status) => status === 200)).toBe(true);
    expect(statuses[100]).toBe(429);

    // Other users keep their own budget
    expect((await admin.client.get("/auth/me")).status).toBe(200);
  });

  it("limits uploads to 20 per hour per user", async () => {
    const admin = await createFileAdmin("upload-limit");
    const user = await createUser(admin.client, "user", "upload-limit-user");

    // Rejected uploads (no file) still count towards the limit
    for (let i = 0; i < 20; i++) {
      expect((await user.client.upload("/sessions", [])).status).toBe(400);
    }
    const blocked = await user.client.upload("/sessions", []);
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toMatch(/Upload limit reached/);
  });

  it("limits simulations to 10 per hour per user", async () => {
    const admin = await createFileAdmin("sim-limit");
    const user = await createUser(admin.client, "user", "sim-limit-user");

    for (let i = 0; i < 10; i++) {
      expect((await user.client.post("/simulator", {})).status).toBe(400);
    }
    const blocked = await user.client.post("/simulator", {});
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toMatch(/Simulation limit reached/);
  });
});
