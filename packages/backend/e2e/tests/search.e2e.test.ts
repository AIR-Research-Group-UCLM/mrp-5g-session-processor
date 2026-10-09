import { beforeAll, describe, expect, it } from "vitest";
import { ApiClient } from "../support/api.js";
import {
  createApiKey,
  createFileAdmin,
  createUser,
  uploadSession,
  waitForProcessing,
  type TestUser,
} from "../support/helpers.js";

interface SearchResult {
  sessionId: string;
  title: string | null;
  matchedText: string;
  matchSource: string;
  sectionType: string | null;
}

describe("search", () => {
  let admin: TestUser;
  let owner: TestUser;
  let stranger: TestUser;
  let sessionId: string;

  const search = async (client: ApiClient, q: string): Promise<SearchResult[]> => {
    const response = await client.get(`/search?q=${encodeURIComponent(q)}`);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.data.total).toBe(response.body.data.results.length);
    return response.body.data.results;
  };

  beforeAll(async () => {
    admin = await createFileAdmin("search");
    owner = await createUser(admin.client, "user", "search-owner");
    stranger = await createUser(admin.client, "user", "search-stranger");
    sessionId = await uploadSession(owner.client, { title: "Expediente Quetzal", userTags: JSON.stringify(["zafiro"]) });
    await waitForProcessing(owner.client, sessionId);
  });

  it("finds sessions by transcript content", async () => {
    const results = await search(owner.client, "ibuprofeno");
    expect(results).toContainEqual(
      expect.objectContaining({ sessionId, matchSource: "transcript", sectionType: "treatment" })
    );
  });

  it("matches transcript words by prefix", async () => {
    const results = await search(owner.client, "ibupro");
    expect(results.some((r) => r.sessionId === sessionId && r.matchSource === "transcript")).toBe(true);
  });

  it("finds sessions by title, summary, keywords, tags and clinical indicators", async () => {
    const expectations: Array<[string, string]> = [
      ["quetzal", "title"],
      ["evolución tratada", "summary"],
      ["náuseas", "keywords"],
      ["zafiro", "tags"],
      ["neurología", "clinical_indicators"],
    ];
    for (const [q, source] of expectations) {
      const results = await search(owner.client, q);
      expect(
        results.some((r) => r.sessionId === sessionId && r.matchSource === source),
        `${q} → ${source}: ${JSON.stringify(results)}`
      ).toBe(true);
    }
  });

  it("works with an API key", async () => {
    const client = ApiClient.anonymous().withBearer((await createApiKey(admin.client, owner.id)).key);
    expect((await search(client, "quetzal")).map((r) => r.sessionId)).toContain(sessionId);
  });

  it("never returns sessions the user cannot access", async () => {
    expect(await search(stranger.client, "quetzal")).toEqual([]);
    expect(await search(stranger.client, "ibuprofeno")).toEqual([]);
  });

  it("includes sessions assigned to the user", async () => {
    await admin.client.put(`/assignments/users/${stranger.id}`, { assignments: [{ sessionId, canWrite: false }] });
    expect((await search(stranger.client, "quetzal")).map((r) => r.sessionId)).toContain(sessionId);
    await admin.client.put(`/assignments/users/${stranger.id}`, { assignments: [] });
  });

  it("returns no results for unmatched queries", async () => {
    expect(await search(owner.client, "xilófono")).toEqual([]);
  });

  it("tolerates FTS syntax characters in the query", async () => {
    for (const q of ['ibuprofeno"', "dolor AND", "(migraña", "*", "NEAR(a b)"]) {
      const response = await owner.client.get(`/search?q=${encodeURIComponent(q)}`);
      expect(response.status, q).toBe(200);
    }
  });

  it("validates the query parameters", async () => {
    expect((await owner.client.get("/search")).status).toBe(400);
    expect((await owner.client.get("/search?q=")).status).toBe(400);
    expect((await owner.client.get(`/search?q=${"a".repeat(501)}`)).status).toBe(400);
    expect((await owner.client.get("/search?q=a&limit=101")).status).toBe(400);
  });

  it("honours the result limit", async () => {
    const response = await owner.client.get("/search?q=migraña&limit=1");
    expect(response.body.data.results).toHaveLength(1);
  });
});
