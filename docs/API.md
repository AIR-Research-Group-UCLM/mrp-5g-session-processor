# External API Guide

This guide explains how an external system can integrate with MRP 5G Session Processor using an API key: upload a consultation recording, wait for it to be processed, and retrieve the transcript, clinical indicators, summaries and patient-friendly sheets. It also covers the standalone report summaries (doctor report → patient-friendly summary).

## Authentication

### Getting an API key

API keys are issued by an administrator from the web UI: **Users → key icon on the user row → Create API key**. Each key:

- Belongs to one user and acts **on behalf of that user**, with exactly the same role and permissions (`admin`, `user` or `readonly`) and the same session/report assignments.
- Is shown **only once**, at creation time. Store it securely; only a SHA-256 hash is kept on the server.
- Can optionally expire (30, 90 or 365 days) and can be revoked at any time from the same screen.

Keys look like `mrp_` followed by 43 URL-safe characters.

### Sending the key

Send the key on every request using either header:

```http
Authorization: Bearer mrp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

```http
X-API-Key: mrp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

No cookies or CSRF tokens are involved. If a key header is present but the key is unknown, revoked or expired, the request fails with `401` (it never falls back to anonymous access).

To check that a key works:

```bash
curl -H "Authorization: Bearer $MRP_API_KEY" https://your-host/api/auth/me
```

```json
{ "success": true, "data": { "user": { "id": "…", "email": "his@hospital.org", "name": "HIS Integration", "role": "user" } } }
```

### What API keys cannot do

Admin endpoints (`/api/users/*`, `/api/assignments/*`, including API key management) **reject API key authentication with `403`**, even for keys owned by an admin. They are only available through an interactive web login.

A key owned by a `readonly` user can only read sessions and report summaries assigned to that user; any write operation returns `403`.

## Conventions

- **Base URL**: `https://your-host[/BASE_PATH]/api`
- **Response envelope**: every JSON response has the shape `{ "success": boolean, "data"?: …, "error"?: string }`. Validation errors also include `details`.
- **Dates**: ISO 8601 strings in UTC.
- **Rate limits** (per user, shared with the web UI):
  - 100 requests/minute across the whole API.
  - 20 uploads/hour on `POST /api/sessions`.
  - 10 simulations/hour on `POST /api/simulator`.

  Responses include `RateLimit-*` headers; exceeding a limit returns `429`.

| Status | Meaning |
|---|---|
| `400` | Validation error or invalid file |
| `401` | Missing, invalid, revoked or expired API key |
| `403` | Authenticated, but the user lacks permission (readonly user, admin endpoint, not owner…) |
| `404` | Resource not found **or not accessible** to this user |
| `413` | Uploaded file exceeds the size limit |
| `429` | Rate limit exceeded |

## Typical flow: audio → session → results

```bash
export MRP_URL="https://your-host/api"
export MRP_API_KEY="mrp_…"
```

### 1. Upload the recording

`POST /sessions` (multipart/form-data)

| Field | Required | Description |
|---|---|---|
| `video` | yes | The audio or video file (field name is `video` for both). Max 500 MB. Formats: MP3, M4A, WAV, OGG, WebM, MP4, MOV, AVI, MKV. The real file content is checked, not just the extension. |
| `title` | no | Session title. If omitted, a title is generated during processing. |
| `notes` | no | Free-text notes. |

```bash
curl -X POST "$MRP_URL/sessions" \
  -H "Authorization: Bearer $MRP_API_KEY" \
  -F "video=@consultation.mp3;type=audio/mpeg" \
  -F "title=Follow-up visit 2026-10-09"
```

```json
{
  "success": true,
  "data": {
    "session": { "id": "8f0c…", "status": "pending", "title": "Follow-up visit 2026-10-09", "…": "…" }
  }
}
```

Keep `data.session.id`; processing starts asynchronously right away.

### 2. Poll the processing status

`GET /sessions/:id/status`

```bash
curl -H "Authorization: Bearer $MRP_API_KEY" "$MRP_URL/sessions/$SESSION_ID/status"
```

```json
{
  "success": true,
  "data": {
    "progress": {
      "sessionId": "8f0c…",
      "status": "processing",
      "currentStep": "segment",
      "steps": [
        { "type": "transcribe", "status": "completed", "durationMs": 41230, "costUsd": 0.04, "…": "…" },
        { "type": "segment", "status": "processing", "…": "…" }
      ],
      "errorMessage": null,
      "startedAt": "2026-10-09T10:00:02.000Z",
      "completedAt": null
    }
  }
}
```

`progress.status` is one of `pending`, `processing`, `completed` or `failed`. Steps run in this order: `transcribe` → `segment` → `generate-metadata` → `generate-consultation-summary` → `complete`. Polling every 10–15 seconds is enough. On `failed`, see `errorMessage`.

### 3. Retrieve the full session

`GET /sessions/:id`

```bash
curl -H "Authorization: Bearer $MRP_API_KEY" "$MRP_URL/sessions/$SESSION_ID"
```

`data.session` contains the session plus everything generated during processing, and `data.videoUrl` a temporary (1 hour) presigned URL to download the original recording:

| Field | Description |
|---|---|
| `id`, `title`, `status`, `language`, `createdAt`, `completedAt`… | Session metadata. `language` is detected from the audio (ISO 639-1). |
| `summary` | General summary of the consultation. |
| `keywords`, `userTags`, `notes` | Generated keywords and user-provided metadata. |
| `transcript[]` | Diarized transcript turns: `speaker` (`DOCTOR`, `PATIENT`, `SPECIALIST`, `OTHER`), `sectionType`, `content`, `startTimeSeconds`, `endTimeSeconds`. |
| `sectionSummaries[]` | One summary per clinical section: `introduction`, `symptoms`, `diagnosis`, `treatment`, `closing`. |
| `clinicalIndicators` | Structured indicators: `urgencyLevel`, `reasonForVisit`, `mainClinicalProblem`, `problemStatus`, `diagnosticHypothesis[]`, `requestedTests[]`, `treatmentPlan`, `warningSigns[]`, `followUpPlan`… |
| `processingTimeline` | Duration, tokens and cost of each processing step. |

### 4. Retrieve the patient-friendly consultation summary

As the last processing step, a patient-friendly sheet is generated for the session.

`GET /sessions/:id/consultation-summary`

```json
{
  "success": true,
  "data": {
    "summary": {
      "id": "…",
      "sessionId": "8f0c…",
      "whatHappened": "…",
      "diagnosis": "…",
      "treatmentPlan": "…",
      "followUp": "…",
      "warningSigns": ["…"],
      "additionalNotes": null,
      "tooltips": { "hypertension": "High blood pressure" },
      "validator": { "status": "completed", "model": "…", "report": { "medication": { "severity": "ok", "notes": [] }, "…": "…" }, "runAt": "…" },
      "confirmation": { "confirmedAt": null, "confirmedBy": null },
      "shareToken": null,
      "shareExpiresAt": null
    }
  }
}
```

`data.summary` is `null` if no summary exists yet. The `validator` block is an automatic safety review (medication, diagnosis, hallucinations, warning signs, glossary) with a severity per axis.

Related endpoints:

| Method | Path | Description |
|---|---|---|
| `POST` | `/sessions/:id/consultation-summary` | (Re)generate the summary |
| `POST` | `/sessions/:id/consultation-summary/revalidate` | Re-run the safety validator |
| `POST` | `/sessions/:id/consultation-summary/confirm` | Mark as reviewed by the clinician (required before sharing with the patient) |
| `DELETE` | `/sessions/:id/consultation-summary/confirm` | Undo the confirmation |
| `GET` | `/sessions/:id/consultation-summary/patient-view` | Patient-facing version (only once confirmed; `404` otherwise) |
| `POST` | `/sessions/:id/consultation-summary/share` | Create a public share link. Body: `{ "expiryHours": 72 }` or `{ "expiryHours": null }` |
| `DELETE` | `/sessions/:id/consultation-summary/share` | Revoke the share link |

## Report summaries

Report summaries turn a written medical report (not a recording) into a patient-friendly sheet with the same structure as the consultation summary.

### Generate from text

`POST /report-summaries` (JSON)

| Field | Required | Description |
|---|---|---|
| `reportText` | yes | Report content, 50–50,000 characters. |
| `title` | no | Up to 200 characters. |

```bash
curl -X POST "$MRP_URL/report-summaries" \
  -H "Authorization: Bearer $MRP_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"title": "Cardiology discharge report", "reportText": "Patient admitted for …"}'
```

The response (`201`) returns the generated summary in `data.summary`, including its `id`. Generation is synchronous, so the request may take a while.

### Generate from a document

First extract the text from a PDF, DOCX or ODT file (max 10 MB), then send it to the endpoint above.

`POST /report-summaries/extract-text` (multipart/form-data, field `file`)

```bash
curl -X POST "$MRP_URL/report-summaries/extract-text" \
  -H "Authorization: Bearer $MRP_API_KEY" \
  -F "file=@report.pdf;type=application/pdf"
```

```json
{ "success": true, "data": { "text": "Patient admitted for …", "filename": "report.pdf" } }
```

### Retrieve

| Method | Path | Description |
|---|---|---|
| `GET` | `/report-summaries?page=1&pageSize=20` | List report summaries owned by or assigned to the user |
| `GET` | `/report-summaries/:id` | Full report summary (`whatHappened`, `diagnosis`, `treatmentPlan`, `followUp`, `warningSigns`, `tooltips`, `validator`, `confirmation`…) |
| `GET` | `/report-summaries/:id/patient-view` | Patient-facing version (only once confirmed) |
| `POST` | `/report-summaries/:id/revalidate` | Re-run the safety validator |
| `POST` / `DELETE` | `/report-summaries/:id/confirm` | Confirm / unconfirm |
| `POST` / `DELETE` | `/report-summaries/:id/share` | Create / revoke a public share link |
| `DELETE` | `/report-summaries/:id` | Delete (owner only) |

## Other endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/sessions?page=1&pageSize=20&status=completed` | List sessions owned by or assigned to the user (use `/search` for text search) |
| `PATCH` | `/sessions/:id` | Update `title`, `userTags` (array) or `notes` (JSON body) |
| `DELETE` | `/sessions/:id` | Delete a session (owner only) |
| `GET` | `/sessions/:id/video/stream` | Stream the original recording (supports `Range` requests) |
| `GET` | `/search?q=…` | Full-text search across transcripts and metadata |
| `GET` | `/simulator/voices` | Voices available for the session simulator |
| `POST` | `/simulator` | Start a simulated consultation |
| `GET` | `/simulator/:id/status` | Simulation progress |

## End-to-end example (bash)

```bash
#!/usr/bin/env bash
set -euo pipefail

AUTH="Authorization: Bearer $MRP_API_KEY"

SESSION_ID=$(curl -sf -X POST "$MRP_URL/sessions" -H "$AUTH" \
  -F "video=@consultation.mp3;type=audio/mpeg" | jq -r '.data.session.id')
echo "Session: $SESSION_ID"

while true; do
  STATUS=$(curl -sf -H "$AUTH" "$MRP_URL/sessions/$SESSION_ID/status" | jq -r '.data.progress.status')
  echo "Status: $STATUS"
  [[ "$STATUS" == "completed" || "$STATUS" == "failed" ]] && break
  sleep 15
done

curl -sf -H "$AUTH" "$MRP_URL/sessions/$SESSION_ID" | jq '.data.session' > session.json
curl -sf -H "$AUTH" "$MRP_URL/sessions/$SESSION_ID/consultation-summary" > consultation-summary.json
```
