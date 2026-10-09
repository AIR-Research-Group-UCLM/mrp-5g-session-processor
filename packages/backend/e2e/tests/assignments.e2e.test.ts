import { beforeAll, describe, expect, it } from "vitest";
import { ApiClient } from "../support/api.js";
import {
  createApiKey,
  createFileAdmin,
  createUser,
  fakeAi,
  uploadSession,
  waitForProcessing,
  type TestUser,
} from "../support/helpers.js";

const REPORT_TEXT =
  "Paciente de 45 años con hipertensión arterial controlada. Se mantiene enalapril 10 mg cada 24 horas y se cita a revisión en tres meses.";

describe("session assignments", () => {
  let admin: TestUser;
  let owner: TestUser;
  let assignee: TestUser;
  let readonly: TestUser;
  let sessionId: string;

  beforeAll(async () => {
    admin = await createFileAdmin("assign");
    owner = await createUser(admin.client, "user", "assign-owner");
    assignee = await createUser(admin.client, "user", "assign-user");
    readonly = await createUser(admin.client, "readonly", "assign-ro");
    sessionId = await uploadSession(owner.client, { title: "Sesión compartida" });
    await waitForProcessing(owner.client, sessionId);
  });

  const setAssignments = (userId: string, assignments: Array<{ sessionId: string; canWrite: boolean }>) =>
    admin.client.put(`/assignments/users/${userId}`, { assignments });

  it("lists sessions available to assign, excluding the user's own", async () => {
    const forAssignee = await admin.client.get(`/assignments/users/${assignee.id}/available-sessions`);
    expect(forAssignee.status).toBe(200);
    const session = forAssignee.body.data.sessions.find((s: { id: string }) => s.id === sessionId);
    expect(session).toMatchObject({
      title: "Sesión compartida",
      ownerId: owner.id,
      ownerName: owner.name,
      isAssigned: false,
      canWrite: false,
    });

    const forOwner = await admin.client.get(`/assignments/users/${owner.id}/available-sessions`);
    expect(forOwner.body.data.sessions.find((s: { id: string }) => s.id === sessionId)).toBeUndefined();
  });

  it("gives read-only access through a read assignment", async () => {
    expect((await assignee.client.get(`/sessions/${sessionId}`)).status).toBe(404);

    const response = await setAssignments(assignee.id, [{ sessionId, canWrite: false }]);
    expect(response.status).toBe(200);

    const assignments = (await admin.client.get(`/assignments/users/${assignee.id}`)).body.data.assignments;
    expect(assignments).toEqual([
      expect.objectContaining({ sessionId, sessionTitle: "Sesión compartida", ownerId: owner.id, canWrite: false }),
    ]);

    expect((await assignee.client.get(`/sessions/${sessionId}`)).status).toBe(200);
    expect((await assignee.client.get(`/sessions/${sessionId}/status`)).status).toBe(200);
    const listed = (await assignee.client.get("/sessions")).body.data.sessions;
    expect(listed).toEqual([expect.objectContaining({ id: sessionId, isOwner: false, isAssigned: true, canWrite: false })]);

    expect((await assignee.client.patch(`/sessions/${sessionId}`, { title: "x" })).status).toBe(403);
    expect((await assignee.client.post(`/sessions/${sessionId}/consultation-summary/confirm`)).status).toBe(403);
  });

  it("allows writes through a write assignment, but never deletion", async () => {
    await setAssignments(assignee.id, [{ sessionId, canWrite: true }]);

    const listed = (await assignee.client.get("/sessions")).body.data.sessions;
    expect(listed[0]).toMatchObject({ id: sessionId, canWrite: true });

    const update = await assignee.client.patch(`/sessions/${sessionId}`, { notes: "Editado por asignado" });
    expect(update.status).toBe(200);

    const remove = await assignee.client.delete(`/sessions/${sessionId}`);
    expect(remove.status).toBe(403);
    expect(remove.body.error).toBe("Only session owner can delete");
  });

  it("lets write assignees run the whole consultation summary workflow", async () => {
    const base = `/sessions/${sessionId}/consultation-summary`;

    expect((await assignee.client.post(`${base}/confirm`)).status).toBe(200);
    const share = await assignee.client.post(`${base}/share`, { expiryHours: 24 });
    expect(share.status).toBe(200);
    expect((await ApiClient.anonymous().get(`/consultation-summary/${share.body.data.token}`)).status).toBe(200);

    expect((await assignee.client.delete(`${base}/share`)).status).toBe(200);
    expect((await ApiClient.anonymous().get(`/consultation-summary/${share.body.data.token}`)).status).toBe(404);
    expect((await assignee.client.delete(`${base}/confirm`)).status).toBe(200);
  });

  it("applies the same permissions when the assignee uses an API key", async () => {
    const client = ApiClient.anonymous().withBearer((await createApiKey(admin.client, assignee.id)).key);
    expect((await client.get(`/sessions/${sessionId}`)).status).toBe(200);
    expect((await client.patch(`/sessions/${sessionId}`, { notes: "Vía API key" })).status).toBe(200);
    expect((await client.delete(`/sessions/${sessionId}`)).status).toBe(403);
  });

  it("never grants writes to readonly users, even with a write assignment", async () => {
    await setAssignments(readonly.id, [{ sessionId, canWrite: true }]);

    expect((await readonly.client.get(`/sessions/${sessionId}`)).status).toBe(200);
    const listed = (await readonly.client.get("/sessions")).body.data.sessions;
    expect(listed[0]).toMatchObject({ id: sessionId, canWrite: false });
    expect((await readonly.client.patch(`/sessions/${sessionId}`, { title: "x" })).status).toBe(403);
  });

  it("replaces all assignments on every update", async () => {
    await setAssignments(assignee.id, []);

    expect((await admin.client.get(`/assignments/users/${assignee.id}`)).body.data.assignments).toEqual([]);
    expect((await assignee.client.get(`/sessions/${sessionId}`)).status).toBe(404);
    expect((await assignee.client.get("/sessions")).body.data.total).toBe(0);
  });

  it("validates the assignment payload", async () => {
    expect((await setAssignments(assignee.id, [{ sessionId: "not-a-uuid", canWrite: true }])).status).toBe(400);
    expect((await admin.client.put(`/assignments/users/${assignee.id}`, {})).status).toBe(400);
  });

  it("is restricted to admins", async () => {
    expect((await owner.client.get(`/assignments/users/${assignee.id}`)).status).toBe(403);
    expect((await owner.client.put(`/assignments/users/${assignee.id}`, { assignments: [] })).status).toBe(403);
    expect((await owner.client.get(`/assignments/users/${assignee.id}/available-sessions`)).status).toBe(403);
  });
});

describe("report summary assignments", () => {
  let admin: TestUser;
  let owner: TestUser;
  let assignee: TestUser;
  let reportId: string;

  beforeAll(async () => {
    admin = await createFileAdmin("assign-reports");
    owner = await createUser(admin.client, "user", "assign-reports-owner");
    assignee = await createUser(admin.client, "user", "assign-reports-user");
    const created = await owner.client.post("/report-summaries", { reportText: REPORT_TEXT, title: "Informe compartido" });
    expect(created.status).toBe(201);
    reportId = created.body.data.summary.id;
  });

  const setAssignments = (userId: string, assignments: Array<{ reportSummaryId: string; canWrite: boolean }>) =>
    admin.client.put(`/assignments/users/${userId}/report-summaries`, { assignments });

  it("lists report summaries available to assign", async () => {
    const response = await admin.client.get(`/assignments/users/${assignee.id}/available-report-summaries`);
    expect(response.status).toBe(200);
    expect(response.body.data.reportSummaries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: reportId, title: "Informe compartido", ownerId: owner.id, isAssigned: false }),
      ])
    );
  });

  it("gives read access through a read assignment", async () => {
    expect((await assignee.client.get(`/report-summaries/${reportId}`)).status).toBe(404);

    expect((await setAssignments(assignee.id, [{ reportSummaryId: reportId, canWrite: false }])).status).toBe(200);
    const assignments = (await admin.client.get(`/assignments/users/${assignee.id}/report-summaries`)).body.data
      .assignments;
    expect(assignments).toEqual([expect.objectContaining({ reportSummaryId: reportId, canWrite: false })]);

    const report = await assignee.client.get(`/report-summaries/${reportId}`);
    expect(report.status).toBe(200);
    expect(report.body.data.summary).toMatchObject({ id: reportId, isOwner: false, canWrite: false });

    const listed = (await assignee.client.get("/report-summaries")).body.data.summaries;
    expect(listed.map((s: { id: string }) => s.id)).toEqual([reportId]);

    expect((await assignee.client.post(`/report-summaries/${reportId}/confirm`)).status).toBe(403);
  });

  it("lets write assignees manage share links, but only the owner confirms or deletes", async () => {
    await setAssignments(assignee.id, [{ reportSummaryId: reportId, canWrite: true }]);
    const report = (await assignee.client.get(`/report-summaries/${reportId}`)).body.data.summary;
    expect(report).toMatchObject({ isOwner: false, canWrite: true });

    // Confirmation carries clinical responsibility: owner only, by design
    expect((await assignee.client.post(`/report-summaries/${reportId}/confirm`)).status).toBe(404);
    expect((await owner.client.post(`/report-summaries/${reportId}/confirm`)).status).toBe(200);

    const share = await assignee.client.post(`/report-summaries/${reportId}/share`, { expiryHours: 24 });
    expect(share.status).toBe(200);
    expect((await ApiClient.anonymous().get(`/consultation-summary/${share.body.data.token}`)).status).toBe(200);
    expect((await assignee.client.delete(`/report-summaries/${reportId}/share`)).status).toBe(200);
    expect((await ApiClient.anonymous().get(`/consultation-summary/${share.body.data.token}`)).status).toBe(404);

    const remove = await assignee.client.delete(`/report-summaries/${reportId}`);
    expect(remove.status).toBe(403);
    expect(remove.body.error).toBe("Only report owner can delete");
  });

  it("lets write assignees revalidate and persists the result", async () => {
    await fakeAi.failNext("validator", 4);
    const created = await owner.client.post("/report-summaries", { reportText: REPORT_TEXT, title: "Pendiente de validar" });
    expect(created.body.data.summary.validator.status).toBe("failed");
    const id = created.body.data.summary.id;

    await setAssignments(assignee.id, [{ reportSummaryId: id, canWrite: true }]);
    const revalidated = await assignee.client.post(`/report-summaries/${id}/revalidate`);
    expect(revalidated.status).toBe(200);
    expect(revalidated.body.data.summary.validator.status).toBe("completed");
    expect((await owner.client.get(`/report-summaries/${id}`)).body.data.summary.validator.status).toBe("completed");
  });

  it("does not let read assignees revalidate or share", async () => {
    await setAssignments(assignee.id, [{ reportSummaryId: reportId, canWrite: false }]);
    expect((await assignee.client.post(`/report-summaries/${reportId}/share`, { expiryHours: 1 })).status).toBe(403);
    expect((await assignee.client.post(`/report-summaries/${reportId}/revalidate`)).status).toBe(403);
  });

  it("removes access when the assignment is removed", async () => {
    await setAssignments(assignee.id, []);
    expect((await assignee.client.get(`/report-summaries/${reportId}`)).status).toBe(404);
  });
});
