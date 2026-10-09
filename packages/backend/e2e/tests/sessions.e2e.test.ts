import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { ApiClient } from "../support/api.js";
import {
  FAKE_DETECTED_LANGUAGE,
  FAKE_METADATA,
  FAKE_SECTION_SUMMARIES,
  FAKE_SEGMENTATION,
} from "../support/fake-data.js";
import {
  audioUpload,
  createApiKey,
  createFileAdmin,
  createUser,
  ctx,
  fakeAi,
  uploadSession,
  waitForProcessing,
  type TestUser,
} from "../support/helpers.js";

const STEPS = ["transcribe", "segment", "generate-metadata", "generate-consultation-summary", "complete"];

describe("session upload and processing (API key)", () => {
  let owner: TestUser;
  let apiClient: ApiClient;
  let sessionId: string;
  let detail: any;

  beforeAll(async () => {
    const admin = await createFileAdmin("sessions");
    owner = await createUser(admin.client, "user", "sessions-owner");
    apiClient = ApiClient.anonymous().withBearer((await createApiKey(admin.client, owner.id)).key);

    const response = await apiClient.upload("/sessions", [audioUpload()], {
      title: "Consulta E2E",
      notes: "Notas de la consulta",
      userTags: JSON.stringify(["urgente", "seguimiento"]),
    });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    sessionId = response.body.data.session.id;

    const progress = await waitForProcessing(apiClient, sessionId);
    expect(progress.status, JSON.stringify(progress)).toBe("completed");
    detail = (await apiClient.get(`/sessions/${sessionId}`)).body.data.session;
  });

  it("returns the created session immediately as pending", async () => {
    const response = await apiClient.upload("/sessions", [audioUpload()], { title: "Pending check" });
    expect(response.status).toBe(201);
    expect(response.body.data.session).toMatchObject({
      title: "Pending check",
      status: "pending",
      userId: owner.id,
      videoOriginalName: "consultation.mp3",
      videoMimeType: "audio/mpeg",
      videoSizeBytes: fs.statSync(ctx().fixtures.audioMp3).size,
      isSimulated: false,
    });
    await waitForProcessing(apiClient, response.body.data.session.id);
  });

  it("reports every processing step as completed with timings and costs", async () => {
    const progress = (await apiClient.get(`/sessions/${sessionId}/status`)).body.data.progress;

    expect(progress).toMatchObject({ sessionId, status: "completed", errorMessage: null });
    expect(progress.steps.map((s: { type: string }) => s.type)).toEqual(STEPS);
    for (const step of progress.steps) {
      expect(step.status, step.type).toBe("completed");
      expect(step.completedAt, step.type).not.toBeNull();
    }
    expect(progress.totalCostUsd).toBeGreaterThan(0);
  });

  it("keeps the metadata provided on upload, including JSON-encoded tags", () => {
    expect(detail).toMatchObject({
      id: sessionId,
      status: "completed",
      title: "Consulta E2E",
      notes: "Notas de la consulta",
      userTags: ["urgente", "seguimiento"],
    });
  });

  it("stores the generated summary, keywords and detected language", () => {
    expect(detail.summary).toBe(FAKE_METADATA.summary);
    expect(detail.keywords).toEqual(FAKE_METADATA.keywords);
    expect(detail.language).toBe(FAKE_DETECTED_LANGUAGE);
    expect(detail.videoDurationSeconds).toBe(3);
    expect(detail.completedAt).not.toBeNull();
    expect(detail.processingCostUsd).toBeGreaterThan(0);
  });

  it("returns the diarized transcript segmented into clinical sections", () => {
    expect(detail.transcript).toHaveLength(FAKE_SEGMENTATION.sections.length);
    detail.transcript.forEach((section: any, index: number) => {
      const expected = FAKE_SEGMENTATION.sections[index]!;
      expect(section).toMatchObject({
        sessionId,
        sectionOrder: index,
        sectionType: expected.sectionType,
        speaker: expected.speaker,
        content: expected.content,
        startTimeSeconds: expected.startTime,
        endTimeSeconds: expected.endTime,
      });
    });
  });

  it("returns one summary per clinical section", () => {
    const summaries = Object.fromEntries(
      detail.sectionSummaries.map((s: { sectionType: string; summary: string }) => [s.sectionType, s.summary])
    );
    expect(summaries).toEqual(FAKE_SECTION_SUMMARIES);
  });

  it("returns the structured clinical indicators", () => {
    const ci = FAKE_METADATA.clinicalIndicators;
    expect(detail.clinicalIndicators).toMatchObject({
      sessionId,
      urgencyLevel: ci.urgencyLevel,
      appointmentPriority: ci.appointmentPriority,
      reasonForVisit: ci.reasonForVisit,
      consultedSpecialty: ci.consultedSpecialty,
      mainClinicalProblem: ci.mainClinicalProblem,
      problemStatus: ci.problemStatus,
      diagnosticHypothesis: ci.diagnosticHypothesis,
      requestedTests: ci.requestedTests,
      treatmentPlan: ci.treatmentPlan,
      patientEducation: ci.patientEducation,
      warningSigns: ci.warningSigns,
      followUpPlan: ci.followUpPlan,
    });
  });

  it("returns the processing timeline", () => {
    expect(detail.processingTimeline.steps.map((s: { type: string }) => s.type)).toEqual(STEPS);
    expect(detail.processingTimeline.totalCostUsd).toBeGreaterThan(0);
    expect(detail.simulationTimeline).toBeNull();
  });

  it("generates title and tags when none are provided", async () => {
    const id = await uploadSession(apiClient);
    await waitForProcessing(apiClient, id);
    const session = (await apiClient.get(`/sessions/${id}`)).body.data.session;

    expect(session.title).toBe(FAKE_METADATA.title);
    expect(session.userTags).toEqual(FAKE_METADATA.userTags);
  });

  it("accepts tags as a plain value or as a repeated multipart field", async () => {
    const single = await apiClient.upload("/sessions", [audioUpload()], { userTags: "cardiología" });
    expect(single.status, JSON.stringify(single.body)).toBe(201);
    expect(single.body.data.session.userTags).toEqual(["cardiología"]);

    const repeated = await apiClient.upload("/sessions", [audioUpload()], { userTags: ["a", "b"] });
    expect(repeated.status, JSON.stringify(repeated.body)).toBe(201);
    expect(repeated.body.data.session.userTags).toEqual(["a", "b"]);

    await waitForProcessing(apiClient, single.body.data.session.id);
    await waitForProcessing(apiClient, repeated.body.data.session.id);
  });

  it("processes video uploads by extracting their audio track", async () => {
    const id = await uploadSession(
      apiClient,
      { title: "Vídeo" },
      { field: "video", path: ctx().fixtures.videoMp4, contentType: "video/mp4" }
    );
    const progress = await waitForProcessing(apiClient, id);
    expect(progress.status, JSON.stringify(progress)).toBe("completed");

    const session = (await apiClient.get(`/sessions/${id}`)).body.data.session;
    expect(session.videoMimeType).toBe("video/mp4");
    expect(session.transcript.length).toBeGreaterThan(0);
  });

  it("accepts model responses with misspelled keys without retrying", async () => {
    // The fake AI returns "EndTime", "start_time", "Keywords" and "UrgencyLevel"
    // in some items, as real models occasionally do
    const countCalls = async (kind: string) => (await fakeAi.calls()).filter((c) => c.kind === kind).length;
    const segmentationBefore = await countCalls("segmentation");
    const metadataBefore = await countCalls("metadata");

    const id = await uploadSession(apiClient, { title: "Claves mal escritas" });
    expect((await waitForProcessing(apiClient, id)).status).toBe("completed");

    expect(await countCalls("segmentation")).toBe(segmentationBefore + 1);
    expect(await countCalls("metadata")).toBe(metadataBefore + 1);
    const session = (await apiClient.get(`/sessions/${id}`)).body.data.session;
    expect(session.transcript[1].endTimeSeconds).toBe(FAKE_SEGMENTATION.sections[1]!.endTime);
    expect(session.transcript[3].startTimeSeconds).toBe(FAKE_SEGMENTATION.sections[3]!.startTime);
    expect(session.keywords).toEqual(FAKE_METADATA.keywords);
    expect(session.clinicalIndicators.urgencyLevel).toBe(FAKE_METADATA.clinicalIndicators.urgencyLevel);
  });

  it("sends the audio to the transcription model", async () => {
    const calls = await fakeAi.calls();
    const kinds = new Set(calls.map((c) => c.kind));
    for (const kind of ["transcription", "language-detection", "segmentation", "metadata", "summary", "tooltips", "validator"]) {
      expect(kinds.has(kind), kind).toBe(true);
    }
  });
});

describe("session upload validation", () => {
  let user: TestUser;

  beforeAll(async () => {
    const admin = await createFileAdmin("upload-validation");
    user = await createUser(admin.client, "user", "upload-validation-user");
  });

  it("requires a file", async () => {
    const response = await user.client.upload("/sessions", [], { title: "No file" });
    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Video file is required");
  });

  it("rejects unsupported MIME types", async () => {
    const response = await user.client.upload("/sessions", [
      { field: "video", path: ctx().fixtures.reportPdf, contentType: "application/pdf" },
    ]);
    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/Invalid file type/);
  });

  it("rejects files whose content does not match an allowed media type", async () => {
    const spoofed = path.join(os.tmpdir(), `spoofed-${process.pid}.mp3`);
    fs.copyFileSync(ctx().fixtures.reportPdf, spoofed);
    try {
      const response = await user.client.upload("/sessions", [
        { field: "video", path: spoofed, contentType: "audio/mpeg" },
      ]);
      expect(response.status).toBe(400);
      expect(response.body.error).toMatch(/does not match a supported media format/);
    } finally {
      fs.rmSync(spoofed, { force: true });
    }
  });

  it("rejects readonly users", async () => {
    const admin = await createFileAdmin("upload-ro");
    const readonly = await createUser(admin.client, "readonly", "upload-ro-user");
    const response = await readonly.client.upload("/sessions", [audioUpload()]);
    expect(response.status).toBe(403);
  });
});

describe("session processing failures", () => {
  it("marks the session as failed with the error when a step keeps failing", async () => {
    const admin = await createFileAdmin("processing-failure");
    const user = await createUser(admin.client, "user", "processing-failure-user");

    // Covers the SDK's own retries plus the backend's withRetry attempts
    await fakeAi.failNext("transcription", 100);
    try {
      const id = await uploadSession(user.client, { title: "Failing" });
      const progress = await waitForProcessing(user.client, id, { timeoutMs: 120_000 });

      expect(progress.status).toBe("failed");
      expect(progress.errorMessage).toBeTruthy();
      const transcribe = progress.steps.find((s: { type: string }) => s.type === "transcribe");
      expect(transcribe.status).toBe("failed");

      const session = (await user.client.get(`/sessions/${id}`)).body.data.session;
      expect(session.status).toBe("failed");
      expect(session.errorMessage).toBeTruthy();
      expect(session.transcript).toEqual([]);
    } finally {
      await fakeAi.failNext("transcription", 0);
    }
  });
});

describe("session read, update, media and delete", () => {
  let owner: TestUser;
  let stranger: TestUser;
  let sessionId: string;

  beforeAll(async () => {
    const admin = await createFileAdmin("session-crud");
    owner = await createUser(admin.client, "user", "session-crud-owner");
    stranger = await createUser(admin.client, "user", "session-crud-stranger");
    sessionId = await uploadSession(owner.client, { title: "CRUD" });
    await waitForProcessing(owner.client, sessionId);
  });

  it("lists own sessions with pagination and status filter", async () => {
    const second = await uploadSession(owner.client, { title: "CRUD 2" });
    await waitForProcessing(owner.client, second);

    const all = (await owner.client.get("/sessions")).body.data;
    expect(all.total).toBe(2);
    expect(all.page).toBe(1);
    expect(all.pageSize).toBe(20);
    expect(all.sessions.map((s: { id: string }) => s.id)).toEqual([second, sessionId]);
    expect(all.sessions[0]).toMatchObject({ isOwner: true, isAssigned: false, canWrite: true, status: "completed" });

    const paged = (await owner.client.get("/sessions?page=2&pageSize=1")).body.data;
    expect(paged.sessions.map((s: { id: string }) => s.id)).toEqual([sessionId]);
    expect(paged.total).toBe(2);

    expect((await owner.client.get("/sessions?status=failed")).body.data.total).toBe(0);
    expect((await owner.client.get("/sessions?status=completed")).body.data.total).toBe(2);
  });

  it("validates list query parameters", async () => {
    expect((await owner.client.get("/sessions?page=0")).status).toBe(400);
    expect((await owner.client.get("/sessions?pageSize=101")).status).toBe(400);
  });

  it("updates title, tags and notes", async () => {
    const response = await owner.client.patch(`/sessions/${sessionId}`, {
      title: "Título actualizado",
      userTags: ["revisado"],
      notes: "Nota nueva",
    });
    expect(response.status).toBe(200);
    expect(response.body.data.session).toMatchObject({
      title: "Título actualizado",
      userTags: ["revisado"],
      notes: "Nota nueva",
    });
    expect((await owner.client.get(`/sessions/${sessionId}`)).body.data.session.title).toBe("Título actualizado");
  });

  it("validates update payloads", async () => {
    expect((await owner.client.patch(`/sessions/${sessionId}`, { userTags: "not-an-array" })).status).toBe(400);
  });

  it("returns a working presigned URL for the original media", async () => {
    const response = await owner.client.get(`/sessions/${sessionId}/video`);
    expect(response.status).toBe(200);

    const media = await fetch(response.body.data.url);
    expect(media.status).toBe(200);
    expect(Buffer.from(await media.arrayBuffer()).equals(fs.readFileSync(ctx().fixtures.audioMp3))).toBe(true);
  });

  it("streams the original media in full", async () => {
    const original = fs.readFileSync(ctx().fixtures.audioMp3);
    const response = await owner.client.get(`/sessions/${sessionId}/video/stream`);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("audio/mpeg");
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect(Buffer.compare(response.body, original)).toBe(0);
  });

  it("streams byte ranges", async () => {
    const original = fs.readFileSync(ctx().fixtures.audioMp3);
    const response = await owner.client.get(`/sessions/${sessionId}/video/stream`, { headers: { Range: "bytes=10-99" } });

    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe(`bytes 10-99/${original.length}`);
    expect(Buffer.compare(response.body, original.subarray(10, 100))).toBe(0);

    const openEnded = await owner.client.get(`/sessions/${sessionId}/video/stream`, {
      headers: { Range: `bytes=${original.length - 10}-` },
    });
    expect(openEnded.status).toBe(206);
    expect(openEnded.body.length).toBe(10);
  });

  it("rejects unsatisfiable ranges with 416", async () => {
    const size = fs.statSync(ctx().fixtures.audioMp3).size;
    for (const range of [`bytes=${size}-`, "bytes=50-10", "bytes=abc-def"]) {
      const response = await owner.client.get(`/sessions/${sessionId}/video/stream`, { headers: { Range: range } });
      expect(response.status, range).toBe(416);
    }
  });

  it("reports accuracy as unavailable for non-simulated sessions", async () => {
    const response = await owner.client.get(`/sessions/${sessionId}/accuracy`);
    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Accuracy is only available for simulated sessions");
  });

  it("hides sessions from users without access", async () => {
    for (const path of ["", "/status", "/video", "/video/stream", "/accuracy", "/consultation-summary"]) {
      const response = await stranger.client.get(`/sessions/${sessionId}${path}`);
      expect(response.status, path).toBe(404);
    }
    expect((await stranger.client.patch(`/sessions/${sessionId}`, { title: "hijack" })).status).toBe(404);
    expect((await stranger.client.delete(`/sessions/${sessionId}`)).status).toBe(404);
    expect((await stranger.client.get("/sessions")).body.data.total).toBe(0);
  });

  it("returns 404 for unknown sessions", async () => {
    const response = await owner.client.get("/sessions/00000000-0000-4000-8000-00000000dead");
    expect(response.status).toBe(404);
  });

  it("deletes the session and its stored media", async () => {
    const id = await uploadSession(owner.client, { title: "To delete" });
    await waitForProcessing(owner.client, id);
    const mediaUrl = (await owner.client.get(`/sessions/${id}/video`)).body.data.url;

    const response = await owner.client.delete(`/sessions/${id}`);
    expect(response.status).toBe(200);

    expect((await owner.client.get(`/sessions/${id}`)).status).toBe(404);
    expect((await fetch(mediaUrl)).status).toBe(404);
  });
});
