import { beforeAll, describe, expect, it } from "vitest";
import { ApiClient } from "../support/api.js";
import { DIALOGUE, FAKE_CONTEXT_SUGGESTION } from "../support/fake-data.js";
import {
  createApiKey,
  createFileAdmin,
  createUser,
  ctx,
  fakeAi,
  waitFor,
  waitForProcessing,
  type TestUser,
} from "../support/helpers.js";

const VOICES = { DOCTOR: "voice-doctor", PATIENT: "voice-patient", SPECIALIST: "voice-specialist" };
const CONTEXT = "Mujer de 35 años con migraña de dos semanas de evolución y náuseas matutinas.";

async function waitForSimulation(client: ApiClient, simulationId: string): Promise<any> {
  return waitFor(
    async () => {
      const response = await client.get(`/simulator/${simulationId}/status`);
      expect(response.status).toBe(200);
      const progress = response.body.data;
      return progress.status === "completed" || progress.status === "failed" ? progress : null;
    },
    { timeoutMs: 90_000, description: `simulation ${simulationId}` }
  );
}

describe("simulator", () => {
  let admin: TestUser;
  let user: TestUser;

  beforeAll(async () => {
    admin = await createFileAdmin("simulator");
    user = await createUser(admin.client, "user", "simulator-user");
  });

  it("lists the configured voices", async () => {
    const response = await user.client.get("/simulator/voices");
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual(ctx().simulatorVoices);
  });

  it("suggests a consultation context", async () => {
    const response = await user.client.post("/simulator/context-suggestion", { language: "es" });
    expect(response.status).toBe(200);
    expect(response.body.data.suggestion).toBe(FAKE_CONTEXT_SUGGESTION);

    expect((await user.client.post("/simulator/context-suggestion", { language: "xx" })).status).toBe(400);
  });

  it("validates simulation requests", async () => {
    const invalid = [
      { context: "short", language: "es", voices: VOICES },
      { context: CONTEXT, language: "xx", voices: VOICES },
      { context: CONTEXT, language: "es", voices: { DOCTOR: "a", PATIENT: "b" } },
      { context: "x".repeat(5001), language: "es", voices: VOICES },
    ];
    for (const body of invalid) {
      expect((await user.client.post("/simulator", body)).status, JSON.stringify(body).slice(0, 80)).toBe(400);
    }
  });

  it("simulates a consultation and processes it into a session", async () => {
    const callsBefore = (await fakeAi.calls()).filter((c) => c.kind === "tts").length;
    const apiClient = ApiClient.anonymous().withBearer((await createApiKey(admin.client, user.id)).key);

    const created = await apiClient.post("/simulator", {
      context: CONTEXT,
      language: "es",
      voices: VOICES,
      title: "Simulación E2E",
      userTags: ["simulada"],
      notes: "Generada por el simulador",
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const { simulationId } = created.body.data;

    const progress = await waitForSimulation(apiClient, simulationId);
    expect(progress, JSON.stringify(progress)).toMatchObject({
      simulationId,
      status: "completed",
      totalSegments: DIALOGUE.length,
      completedSegments: DIALOGUE.length,
      errorMessage: null,
    });
    expect(progress.sessionId).toBeTruthy();
    expect(progress.timeline.totalCostUsd).toBeGreaterThan(0);

    // One TTS request per dialogue turn, using the voice mapped to each speaker
    const ttsCalls = (await fakeAi.calls()).filter((c) => c.kind === "tts").slice(callsBefore);
    expect(ttsCalls).toHaveLength(DIALOGUE.length);
    expect(ttsCalls.map((c) => c.path.split("/").pop()).sort()).toEqual(
      DIALOGUE.map((t) => VOICES[t.speaker]).sort()
    );

    const sessionId = progress.sessionId as string;
    expect((await waitForProcessing(apiClient, sessionId)).status).toBe("completed");

    const session = (await apiClient.get(`/sessions/${sessionId}`)).body.data.session;
    expect(session).toMatchObject({
      isSimulated: true,
      title: "Simulación E2E",
      userTags: ["simulada"],
      notes: "Generada por el simulador",
      videoMimeType: "audio/mpeg",
    });
    expect(session.simulationTimeline).not.toBeNull();

    const listed = (await apiClient.get("/sessions")).body.data.sessions;
    expect(listed.find((s: { id: string }) => s.id === sessionId)).toMatchObject({ isSimulated: true });

    // The fake transcription reproduces the simulated dialogue word for word
    const accuracy = await apiClient.get(`/sessions/${sessionId}/accuracy`);
    expect(accuracy.status).toBe(200);
    expect(accuracy.body.data.accuracy).toMatchObject({
      overallTextSimilarity: 100,
      wordErrorRate: 0,
      speakerAccuracy: 100,
      stats: { originalSegments: DIALOGUE.length, transcribedSegments: DIALOGUE.length },
    });
  });

  it("reports a failed simulation when the conversation cannot be generated", async () => {
    await fakeAi.failNext("conversation", 100);
    try {
      const created = await user.client.post("/simulator", { context: CONTEXT, language: "es", voices: VOICES });
      expect(created.status).toBe(201);
      const progress = await waitForSimulation(user.client, created.body.data.simulationId);
      expect(progress.status).toBe("failed");
      expect(progress.errorMessage).toBeTruthy();
      expect(progress.sessionId).toBeNull();
    } finally {
      await fakeAi.failNext("conversation", 0);
    }
  });

  it("hides simulations from other users", async () => {
    const created = await user.client.post("/simulator", { context: CONTEXT, language: "es", voices: VOICES });
    const { simulationId } = created.body.data;
    await waitForSimulation(user.client, simulationId);

    const other = await createUser(admin.client, "user", "simulator-other");
    expect((await other.client.get(`/simulator/${simulationId}/status`)).status).toBe(404);
  });

  it("rejects readonly users", async () => {
    const readonly = await createUser(admin.client, "readonly", "simulator-ro");
    expect((await readonly.client.post("/simulator", { context: CONTEXT, language: "es", voices: VOICES })).status).toBe(403);
    expect((await readonly.client.get("/simulator/voices")).status).toBe(200);
  });
});
