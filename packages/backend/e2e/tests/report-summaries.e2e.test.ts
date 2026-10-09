import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { ApiClient } from "../support/api.js";
import { FAKE_MEDICATION_ISSUE, FAKE_PATIENT_SUMMARY, FAKE_TOOLTIPS } from "../support/fake-data.js";
import { createApiKey, createFileAdmin, createUser, ctx, fakeAi, type TestUser } from "../support/helpers.js";

// Mentions every tooltip term so the deterministic glossary axis reports no issues
const REPORT_TEXT =
  "Paciente de 35 años con migraña sin aura de dos semanas de evolución. Se pauta ibuprofeno 600 mg cada 8 horas durante cinco días y revisión en un mes.";

const EXTRACTED_TEXT_START = "Informe medico de prueba E2E. Paciente con cefalea tensional";

describe("report summaries", () => {
  let owner: TestUser;
  let stranger: TestUser;
  let apiClient: ApiClient;
  let reportId: string;

  beforeAll(async () => {
    const admin = await createFileAdmin("reports");
    owner = await createUser(admin.client, "user", "reports-owner");
    stranger = await createUser(admin.client, "user", "reports-stranger");
    apiClient = ApiClient.anonymous().withBearer((await createApiKey(admin.client, owner.id)).key);
  });

  it("generates a patient-friendly summary from report text", async () => {
    const response = await apiClient.post("/report-summaries", { reportText: REPORT_TEXT, title: "Alta neurología" });

    expect(response.status).toBe(201);
    const summary = response.body.data.summary;
    reportId = summary.id;
    expect(summary).toMatchObject({
      userId: owner.id,
      title: "Alta neurología",
      ...FAKE_PATIENT_SUMMARY,
      tooltips: FAKE_TOOLTIPS,
      isOwner: true,
      canWrite: true,
      shareToken: null,
      confirmation: { confirmedAt: null, confirmedBy: null },
    });
    expect(summary.validator).toMatchObject({ status: "completed", model: "fake-validator-model" });
    expect(summary.validator.report).toEqual({
      medication: { severity: "major", notes: [FAKE_MEDICATION_ISSUE] },
      diagnostic: { severity: "ok", notes: [] },
      hallucination: { severity: "ok", notes: [] },
      warningSign: { severity: "ok", notes: [] },
      glossary: { severity: "ok", notes: [] },
    });
  });

  it("works without a title", async () => {
    const response = await apiClient.post("/report-summaries", { reportText: REPORT_TEXT });
    expect(response.status).toBe(201);
    expect(response.body.data.summary.title).toBeNull();
  });

  it("validates the report text length and title", async () => {
    const invalid = [
      {},
      { reportText: "too short" },
      { reportText: "x".repeat(50_001) },
      { reportText: REPORT_TEXT, title: "x".repeat(201) },
    ];
    for (const body of invalid) {
      const response = await apiClient.post("/report-summaries", body);
      expect(response.status, JSON.stringify(body).slice(0, 60)).toBe(400);
    }
  });

  it("fails without storing anything when the summary model keeps failing", async () => {
    const before = (await apiClient.get("/report-summaries")).body.data.total;
    await fakeAi.failNext("summary", 100);
    try {
      const response = await apiClient.post("/report-summaries", { reportText: REPORT_TEXT });
      expect(response.status).toBeGreaterThanOrEqual(500);
    } finally {
      await fakeAi.failNext("summary", 0);
    }
    expect((await apiClient.get("/report-summaries")).body.data.total).toBe(before);
  });

  it("lists and paginates the user's report summaries", async () => {
    const list = await apiClient.get("/report-summaries");
    expect(list.status).toBe(200);
    expect(list.body.data).toMatchObject({ total: 2, page: 1, pageSize: 20 });
    expect(list.body.data.summaries.map((s: { id: string }) => s.id)).toContain(reportId);
    expect(list.body.data.summaries[0]).toEqual(
      expect.objectContaining({ isOwner: true, canWrite: true, shareToken: null })
    );

    const page = await apiClient.get("/report-summaries?page=2&pageSize=1");
    expect(page.body.data.summaries).toHaveLength(1);
    expect((await apiClient.get("/report-summaries?pageSize=0")).status).toBe(400);
  });

  it("returns a report summary by id", async () => {
    const response = await apiClient.get(`/report-summaries/${reportId}`);
    expect(response.status).toBe(200);
    expect(response.body.data.summary).toMatchObject({ id: reportId, title: "Alta neurología", ...FAKE_PATIENT_SUMMARY });
  });

  it("hides report summaries from other users", async () => {
    for (const [method, path] of [
      ["GET", `/report-summaries/${reportId}`],
      ["GET", `/report-summaries/${reportId}/patient-view`],
      ["POST", `/report-summaries/${reportId}/confirm`],
      ["POST", `/report-summaries/${reportId}/share`],
      ["POST", `/report-summaries/${reportId}/revalidate`],
      ["DELETE", `/report-summaries/${reportId}`],
    ] as const) {
      const response = await stranger.client.request(method, path, { json: method === "GET" ? undefined : {} });
      expect(response.status, `${method} ${path}`).toBe(404);
    }
    expect((await stranger.client.get("/report-summaries")).body.data.total).toBe(0);
  });

  it("runs the confirm → patient view → share workflow", async () => {
    const base = `/report-summaries/${reportId}`;

    expect((await apiClient.get(`${base}/patient-view`)).status).toBe(404);
    expect((await apiClient.post(`${base}/share`, { expiryHours: 24 })).status).toBe(409);

    const confirm = await apiClient.post(`${base}/confirm`);
    expect(confirm.status).toBe(200);
    expect(confirm.body.data.summary.confirmation.confirmedBy).toBe(owner.id);

    const view = await apiClient.get(`${base}/patient-view`);
    expect(view.status).toBe(200);
    expect(view.body.data.summary).toMatchObject(FAKE_PATIENT_SUMMARY);

    const share = await apiClient.post(`${base}/share`, { expiryHours: 24 });
    expect(share.status).toBe(200);
    const publicView = await ApiClient.anonymous().get(`/consultation-summary/${share.body.data.token}`);
    expect(publicView.status).toBe(200);
    expect(publicView.body.data.summary).toMatchObject(FAKE_PATIENT_SUMMARY);

    expect((await apiClient.delete(`${base}/share`)).status).toBe(200);
    expect((await ApiClient.anonymous().get(`/consultation-summary/${share.body.data.token}`)).status).toBe(404);

    const unconfirm = await apiClient.delete(`${base}/confirm`);
    expect(unconfirm.status).toBe(200);
    expect((await apiClient.get(`${base}/patient-view`)).status).toBe(404);
  });

  it("cannot be revalidated once validation succeeded, because the source text is discarded", async () => {
    const response = await apiClient.post(`/report-summaries/${reportId}/revalidate`);
    expect(response.status).toBe(409);
    expect(response.body.error).toMatch(/revalidation is unavailable/);
  });

  it("keeps the source text after a failed validation so it can be revalidated", async () => {
    await fakeAi.failNext("validator", 4);
    const created = await apiClient.post("/report-summaries", { reportText: REPORT_TEXT, title: "Validación fallida" });
    expect(created.status).toBe(201);
    const { id, validator } = created.body.data.summary;
    expect(validator).toMatchObject({ status: "failed", report: null });

    expect((await apiClient.post(`/report-summaries/${id}/confirm`)).status).toBe(409);

    const revalidated = await apiClient.post(`/report-summaries/${id}/revalidate`);
    expect(revalidated.status).toBe(200);
    expect(revalidated.body.data.summary.validator.status).toBe("completed");
    expect((await apiClient.get(`/report-summaries/${id}`)).body.data.summary.validator.status).toBe("completed");

    expect((await apiClient.post(`/report-summaries/${id}/confirm`)).status).toBe(200);
    expect((await apiClient.post(`/report-summaries/${id}/revalidate`)).status).toBe(409);
  });

  it("deletes a report summary", async () => {
    const created = await apiClient.post("/report-summaries", { reportText: REPORT_TEXT, title: "Borrar" });
    const id = created.body.data.summary.id;

    expect((await apiClient.delete(`/report-summaries/${id}`)).status).toBe(200);
    expect((await apiClient.get(`/report-summaries/${id}`)).status).toBe(404);
  });

  it("rejects readonly users on write operations", async () => {
    const admin = await createFileAdmin("reports-ro");
    const readonly = await createUser(admin.client, "readonly", "reports-ro-user");
    expect((await readonly.client.post("/report-summaries", { reportText: REPORT_TEXT })).status).toBe(403);
    expect((await readonly.client.get("/report-summaries")).status).toBe(200);
  });
});

describe("report text extraction", () => {
  let client: ApiClient;

  beforeAll(async () => {
    const admin = await createFileAdmin("extract");
    client = (await createUser(admin.client, "user", "extract-user")).client;
  });

  const cases = [
    ["PDF", () => ctx().fixtures.reportPdf, "application/pdf"],
    ["DOCX", () => ctx().fixtures.reportDocx, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    ["ODT", () => ctx().fixtures.reportOdt, "application/vnd.oasis.opendocument.text"],
  ] as const;

  for (const [label, filePath, contentType] of cases) {
    it(`extracts text from ${label} files`, async () => {
      const response = await client.upload("/report-summaries/extract-text", [
        { field: "file", path: filePath(), contentType },
      ]);
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      expect(response.body.data.text.startsWith(EXTRACTED_TEXT_START)).toBe(true);
      expect(response.body.data.filename).toBe(filePath().split("/").pop());
    });
  }

  it("requires a file", async () => {
    const response = await client.upload("/report-summaries/extract-text", []);
    expect(response.status).toBe(400);
    expect(response.body.error).toBe("No file provided");
  });

  it("rejects unsupported document types with 400", async () => {
    const response = await client.upload("/report-summaries/extract-text", [
      { field: "file", path: ctx().fixtures.audioMp3, contentType: "audio/mpeg" },
    ]);
    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/Unsupported file type/);
  });

  it("rejects documents larger than 10 MB with 413", async () => {
    const big = path.join(os.tmpdir(), `big-${process.pid}.pdf`);
    fs.writeFileSync(big, Buffer.alloc(10 * 1024 * 1024 + 1));
    try {
      const response = await client.upload("/report-summaries/extract-text", [
        { field: "file", path: big, contentType: "application/pdf" },
      ]);
      expect(response.status).toBe(413);
    } finally {
      fs.rmSync(big, { force: true });
    }
  });

  it("feeds extracted text into summary generation", async () => {
    const extracted = await client.upload("/report-summaries/extract-text", [
      { field: "file", path: ctx().fixtures.reportPdf, contentType: "application/pdf" },
    ]);
    const generated = await client.post("/report-summaries", { reportText: extracted.body.data.text });
    expect(generated.status).toBe(201);
  });
});
