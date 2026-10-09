import { beforeAll, describe, expect, it } from "vitest";
import { ApiClient } from "../support/api.js";
import {
  FAKE_MEDICATION_ISSUE,
  FAKE_PATIENT_SUMMARY,
  FAKE_TOOLTIPS,
} from "../support/fake-data.js";
import {
  createApiKey,
  createFileAdmin,
  createUser,
  fakeAi,
  uploadSession,
  waitForProcessing,
  withDb,
  type TestUser,
} from "../support/helpers.js";

describe("consultation summary", () => {
  let owner: TestUser;
  let sessionId: string;
  let base: string;

  beforeAll(async () => {
    const admin = await createFileAdmin("consultation");
    owner = await createUser(admin.client, "user", "consultation-owner");
    sessionId = await uploadSession(owner.client, { title: "Consulta con resumen" });
    await waitForProcessing(owner.client, sessionId);
    base = `/sessions/${sessionId}/consultation-summary`;
  });

  it("is generated automatically as the last processing step", async () => {
    const response = await owner.client.get(base);

    expect(response.status).toBe(200);
    expect(response.body.data.summary).toMatchObject({
      sessionId,
      ...FAKE_PATIENT_SUMMARY,
      tooltips: FAKE_TOOLTIPS,
      shareToken: null,
      shareExpiresAt: null,
      confirmation: { confirmedAt: null, confirmedBy: null },
    });
  });

  it("includes the safety validator report", async () => {
    const { validator } = (await owner.client.get(base)).body.data.summary;

    expect(validator).toMatchObject({ status: "completed", model: "fake-validator-model" });
    expect(validator.runAt).not.toBeNull();
    expect(validator.report).toEqual({
      medication: { severity: "major", notes: [FAKE_MEDICATION_ISSUE] },
      diagnostic: { severity: "ok", notes: [] },
      hallucination: { severity: "ok", notes: [] },
      warningSign: { severity: "ok", notes: [] },
      glossary: { severity: "ok", notes: [] },
    });
  });

  it("is retrievable with an API key", async () => {
    const admin = await createFileAdmin("consultation-key");
    const key = (await createApiKey(admin.client, owner.id)).key;
    const response = await ApiClient.anonymous().withXApiKey(key).get(base);
    expect(response.status).toBe(200);
    expect(response.body.data.summary.sessionId).toBe(sessionId);
  });

  it("keeps the patient view and sharing locked until a clinician confirms", async () => {
    expect((await owner.client.get(`${base}/patient-view`)).status).toBe(404);

    const share = await owner.client.post(`${base}/share`, { expiryHours: 24 });
    expect(share.status).toBe(409);
  });

  it("confirms the summary and exposes the patient view", async () => {
    const confirm = await owner.client.post(`${base}/confirm`);
    expect(confirm.status).toBe(200);
    expect(confirm.body.data.summary.confirmation.confirmedBy).toBe(owner.id);
    expect(confirm.body.data.summary.confirmation.confirmedAt).not.toBeNull();

    // Confirming twice is idempotent
    expect((await owner.client.post(`${base}/confirm`)).status).toBe(200);

    const view = await owner.client.get(`${base}/patient-view`);
    expect(view.status).toBe(200);
    expect(view.body.data).toMatchObject({
      sessionTitle: "Consulta con resumen",
      summary: { ...FAKE_PATIENT_SUMMARY, tooltips: FAKE_TOOLTIPS },
    });
  });

  it("shares a public link that works without authentication", async () => {
    const share = await owner.client.post(`${base}/share`, { expiryHours: 24 });
    expect(share.status).toBe(200);
    const { token, expiresAt } = share.body.data;
    expect(token).toMatch(/^[a-f0-9]{64}$/);
    expect(new Date(expiresAt).getTime()).toBeGreaterThan(Date.now() + 23 * 3600 * 1000);

    const summary = (await owner.client.get(base)).body.data.summary;
    expect(summary.shareToken).toBe(token);

    const publicView = await ApiClient.anonymous().get(`/consultation-summary/${token}`);
    expect(publicView.status).toBe(200);
    expect(publicView.body.data).toMatchObject({
      sessionTitle: "Consulta con resumen",
      expiresAt,
      summary: { ...FAKE_PATIENT_SUMMARY },
    });
  });

  it("supports links that never expire", async () => {
    const share = await owner.client.post(`${base}/share`, { expiryHours: null });
    expect(share.status).toBe(200);
    expect(share.body.data.expiresAt).toBeNull();
    expect((await ApiClient.anonymous().get(`/consultation-summary/${share.body.data.token}`)).status).toBe(200);
  });

  it("stops serving a link once it has expired", async () => {
    const { token } = (await owner.client.post(`${base}/share`, { expiryHours: 24 })).body.data;
    const oneMinuteAgo = new Date(Date.now() - 60_000).toISOString();
    withDb((db) =>
      db.prepare("UPDATE consultation_summaries SET share_expires_at = ? WHERE share_token = ?").run(oneMinuteAgo, token)
    );

    expect((await ApiClient.anonymous().get(`/consultation-summary/${token}`)).status).toBe(404);
  });

  it("revokes the public link", async () => {
    const { token } = (await owner.client.post(`${base}/share`, { expiryHours: 24 })).body.data;

    expect((await owner.client.delete(`${base}/share`)).status).toBe(200);
    expect((await owner.client.get(base)).body.data.summary.shareToken).toBeNull();
    expect((await ApiClient.anonymous().get(`/consultation-summary/${token}`)).status).toBe(404);
  });

  it("validates public link tokens", async () => {
    expect((await ApiClient.anonymous().get("/consultation-summary/not-a-token")).status).toBe(400);
    expect((await ApiClient.anonymous().get(`/consultation-summary/${"0".repeat(64)}`)).status).toBe(404);
  });

  it("hides the patient view and public link again when unconfirmed", async () => {
    const { token } = (await owner.client.post(`${base}/share`, { expiryHours: 24 })).body.data;

    const unconfirm = await owner.client.delete(`${base}/confirm`);
    expect(unconfirm.status).toBe(200);
    expect(unconfirm.body.data.summary.confirmation).toEqual({ confirmedAt: null, confirmedBy: null });

    expect((await owner.client.get(`${base}/patient-view`)).status).toBe(404);
    expect((await ApiClient.anonymous().get(`/consultation-summary/${token}`)).status).toBe(404);
  });

  it("re-runs the safety validator and clears any prior confirmation", async () => {
    await owner.client.post(`${base}/confirm`);
    const before = (await owner.client.get(base)).body.data.summary.validator.runAt;

    const response = await owner.client.post(`${base}/revalidate`);
    expect(response.status).toBe(200);
    expect(response.body.data.summary.validator.status).toBe("completed");
    expect(response.body.data.summary.validator.runAt >= before).toBe(true);
    expect(response.body.data.summary.confirmation.confirmedAt).toBeNull();
  });

  it("refuses confirmation while the safety validator has failed", async () => {
    await fakeAi.failNext("validator", 4);
    const failed = await owner.client.post(`${base}/revalidate`);
    expect(failed.status).toBe(200);
    expect(failed.body.data.summary.validator).toMatchObject({ status: "failed", report: null });

    const confirm = await owner.client.post(`${base}/confirm`);
    expect(confirm.status).toBe(409);

    const recovered = await owner.client.post(`${base}/revalidate`);
    expect(recovered.body.data.summary.validator.status).toBe("completed");
    expect((await owner.client.post(`${base}/confirm`)).status).toBe(200);
  });

  it("regenerates the summary on demand", async () => {
    const response = await owner.client.post(base);
    expect(response.status).toBe(200);
    expect(response.body.data.summary).toMatchObject({ sessionId, ...FAKE_PATIENT_SUMMARY });
    expect(response.body.data.summary.validator.status).toBe("completed");
  });

  it("cannot be generated for a session whose processing did not complete", async () => {
    await fakeAi.failNext("transcription", 100);
    try {
      const failedId = await uploadSession(owner.client, { title: "Sin transcripción" });
      expect((await waitForProcessing(owner.client, failedId, { timeoutMs: 120_000 })).status).toBe("failed");

      expect((await owner.client.get(`/sessions/${failedId}/consultation-summary`)).body.data.summary).toBeNull();
      const response = await owner.client.post(`/sessions/${failedId}/consultation-summary`);
      expect(response.status).toBe(400);
      expect((await owner.client.post(`/sessions/${failedId}/consultation-summary/confirm`)).status).toBe(404);
    } finally {
      await fakeAi.failNext("transcription", 0);
    }
  });
});
