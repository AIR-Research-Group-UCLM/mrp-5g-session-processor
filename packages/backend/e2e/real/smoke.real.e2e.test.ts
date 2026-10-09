/**
 * Opt-in smoke test against the real AI providers (OpenAI, Open WebUI, ElevenLabs).
 * Run with `pnpm test:e2e:real`. It costs money on every run and takes several
 * minutes, so it only checks structure, never exact model output.
 *
 * The three scenarios are independent and run concurrently (the backend
 * processes two sessions at a time), so wall time is that of the slowest one.
 * Concurrent tests must use the `expect` from their own test context.
 */
import { beforeAll, describe, it, type ExpectStatic } from "vitest";
import { ApiClient } from "../support/api.js";
import {
  createApiKey,
  createFileAdmin,
  createUser,
  ctx,
  waitFor,
  waitForProcessing,
  type TestUser,
} from "../support/helpers.js";

const PROCESSING_TIMEOUT_MS = 15 * 60_000;
// Stay well below the 100 requests/minute per-user rate limit while polling
const POLL_INTERVAL_MS = 5_000;
const SPEAKERS = ["DOCTOR", "PATIENT", "SPECIALIST", "OTHER"];
const SECTIONS = ["introduction", "symptoms", "diagnosis", "treatment", "closing"];
const REPORT_TEXT =
  "Paciente de 58 años con diabetes mellitus tipo 2 e hipertensión arterial. Acude por control. HbA1c 7,8 %. " +
  "Se ajusta metformina a 850 mg cada 12 horas y se mantiene enalapril 10 mg al día. " +
  "Se recomienda dieta y ejercicio. Signos de alarma: dolor torácico o mareo intenso. Revisión en tres meses.";

function expectPatientSummary(expect: ExpectStatic, summary: any) {
  for (const field of ["whatHappened", "diagnosis", "treatmentPlan", "followUp"]) {
    expect(typeof summary[field], field).toBe("string");
    expect(summary[field].length, field).toBeGreaterThan(0);
  }
  expect(Array.isArray(summary.warningSigns)).toBe(true);
  expect(["completed", "failed"]).toContain(summary.validator.status);
}

describe.concurrent("real AI smoke test", () => {
  let user: TestUser;
  let client: ApiClient;

  beforeAll(async () => {
    const admin = await createFileAdmin("real");
    user = await createUser(admin.client, "user", "real-user");
    client = ApiClient.anonymous().withBearer((await createApiKey(admin.client, user.id)).key);
  });

  it("processes a real consultation recording end to end", async ({ expect }) => {
    const upload = await client.upload("/sessions", [
      { field: "video", path: ctx().fixtures.sampleSessionAudio, contentType: "audio/mpeg" },
    ]);
    expect(upload.status, JSON.stringify(upload.body)).toBe(201);
    const sessionId = upload.body.data.session.id;

    const progress = await waitForProcessing(client, sessionId, { timeoutMs: PROCESSING_TIMEOUT_MS, intervalMs: POLL_INTERVAL_MS });
    expect(progress.status, JSON.stringify(progress)).toBe("completed");

    const session = (await client.get(`/sessions/${sessionId}`)).body.data.session;
    expect(session.title).toBeTruthy();
    expect(session.summary).toBeTruthy();
    expect(session.keywords.length).toBeGreaterThan(0);
    expect(session.language).toMatch(/^[a-z]{2}$/);
    expect(session.transcript.length).toBeGreaterThan(0);
    for (const section of session.transcript) {
      expect(SPEAKERS).toContain(section.speaker);
      expect(SECTIONS).toContain(section.sectionType);
      expect(section.content.length).toBeGreaterThan(0);
    }
    expect(session.sectionSummaries.length).toBeGreaterThan(0);
    expect(session.clinicalIndicators).not.toBeNull();

    const consultation = await client.get(`/sessions/${sessionId}/consultation-summary`);
    expect(consultation.status).toBe(200);
    expectPatientSummary(expect, consultation.body.data.summary);
  });

  it("generates a real report summary", async ({ expect }) => {
    const response = await client.post("/report-summaries", { reportText: REPORT_TEXT, title: "Smoke real" });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expectPatientSummary(expect, response.body.data.summary);
  });

  it("simulates and processes a real consultation", async ({ expect }) => {
    const voices = ctx().simulatorVoices;
    expect(voices.length).toBeGreaterThan(0);
    const voiceAt = (index: number) => voices[index % voices.length]!.id;

    const suggestion = await client.post("/simulator/context-suggestion", { language: "es" });
    expect(suggestion.status).toBe(200);
    expect(suggestion.body.data.suggestion.length).toBeGreaterThan(0);

    const created = await client.post("/simulator", {
      context: suggestion.body.data.suggestion,
      language: "es",
      voices: { DOCTOR: voiceAt(0), PATIENT: voiceAt(1), SPECIALIST: voiceAt(2) },
      title: "Smoke real simulado",
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);

    const simulation = await waitFor(
      async () => {
        const progress = (await client.get(`/simulator/${created.body.data.simulationId}/status`)).body.data;
        return progress.status === "completed" || progress.status === "failed" ? progress : null;
      },
      { timeoutMs: PROCESSING_TIMEOUT_MS, intervalMs: POLL_INTERVAL_MS, description: "real simulation" }
    );
    expect(simulation.status, JSON.stringify(simulation)).toBe("completed");

    const progress = await waitForProcessing(client, simulation.sessionId, { timeoutMs: PROCESSING_TIMEOUT_MS, intervalMs: POLL_INTERVAL_MS });
    expect(progress.status, JSON.stringify(progress)).toBe("completed");

    const accuracy = await client.get(`/sessions/${simulation.sessionId}/accuracy`);
    expect(accuracy.status).toBe(200);
    expect(accuracy.body.data.accuracy.overallTextSimilarity).toBeGreaterThan(50);
  });
});
