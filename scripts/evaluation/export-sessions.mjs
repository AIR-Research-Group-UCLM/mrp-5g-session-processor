// export-sessions.mjs — Dump everything needed to evaluate processed sessions.
//
// Runs inside the backend container, where the S3 credentials, the SQLite
// database and the backend dependencies are already available. The database
// is opened read-only and nothing is written to S3.
//
// Usage (from the repository root, against a Docker deployment):
//   docker exec -i -e SESSION_IDS="<id1> <id2> ..." mrp-app \
//     node --input-type=module - < scripts/evaluation/export-sessions.mjs > export.json
//
// Output: a JSON array with one object per session containing the processed
// case record (sections, section summaries, clinical indicators, metadata),
// the per-stage processing records, the simulation record (if any), the raw
// diarised ASR output and, for simulated sessions, the simulator script used
// as reference transcript.

import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import Database from "better-sqlite3";

const ids = (process.env.SESSION_IDS ?? "").split(/[\s,]+/).filter(Boolean);
if (ids.length === 0) {
  console.error("SESSION_IDS is empty");
  process.exit(1);
}

const db = new Database(process.env.DATABASE_PATH ?? "/app/data/mrp.db", {
  readonly: true,
  fileMustExist: true,
});

const s3 = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY,
    secretAccessKey: process.env.S3_SECRET_KEY,
  },
  forcePathStyle: true,
});

async function getJson(key) {
  try {
    const res = await s3.send(new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }));
    return JSON.parse(await res.Body.transformToString("utf-8"));
  } catch (err) {
    if (err?.name === "NoSuchKey") return null;
    throw err;
  }
}

function parseJson(value) {
  return value == null ? null : JSON.parse(value);
}

const out = [];
for (const id of ids) {
  const s = db.prepare("SELECT * FROM medical_sessions WHERE id = ?").get(id);
  if (!s) {
    console.error(`Session not found: ${id}`);
    process.exit(1);
  }

  const sections = db
    .prepare(
      `SELECT section_order AS "order", section_type AS sectionType, speaker, content,
              start_time_seconds AS start, end_time_seconds AS "end"
       FROM transcript_sections WHERE session_id = ? ORDER BY section_order`
    )
    .all(id);
  const sectionSummaries = db
    .prepare("SELECT section_type AS sectionType, summary FROM section_summaries WHERE session_id = ?")
    .all(id);
  const ci = db.prepare("SELECT * FROM clinical_indicators WHERE session_id = ?").get(id);
  const jobs = db
    .prepare(
      `SELECT job_type AS jobType, status, started_at AS startedAt, completed_at AS completedAt,
              input_tokens AS inputTokens, output_tokens AS outputTokens,
              audio_duration_seconds AS audioDurationSeconds, cost_usd AS costUsd
       FROM processing_jobs WHERE session_id = ? ORDER BY created_at`
    )
    .all(id);
  const simulation =
    db
      .prepare(
        `SELECT id, context, language, voices, created_at AS createdAt, completed_at AS completedAt,
                conversation_started_at AS conversationStartedAt, conversation_completed_at AS conversationCompletedAt,
                audio_started_at AS audioStartedAt, audio_completed_at AS audioCompletedAt,
                concatenation_started_at AS concatenationStartedAt,
                concatenation_completed_at AS concatenationCompletedAt,
                conversation_cost_usd AS conversationCostUsd, elevenlabs_characters AS elevenlabsCharacters,
                elevenlabs_cost_usd AS elevenlabsCostUsd, total_cost_usd AS totalCostUsd
         FROM simulations WHERE session_id = ?`
      )
      .get(id) ?? null;

  out.push({
    id: s.id,
    title: s.title,
    language: s.language,
    isSimulated: s.is_simulated === 1,
    status: s.status,
    durationSeconds: s.video_duration_seconds,
    processingCostUsd: s.processing_cost_usd,
    createdAt: s.created_at,
    startedAt: s.started_at,
    completedAt: s.completed_at,
    summary: s.summary,
    keywords: parseJson(s.keywords),
    userTags: parseJson(s.user_tags),
    sections,
    sectionSummaries,
    clinicalIndicators: ci && {
      urgencyLevel: ci.urgency_level,
      appointmentPriority: ci.appointment_priority,
      reasonForVisit: ci.reason_for_visit,
      consultedSpecialty: ci.consulted_specialty,
      mainClinicalProblem: ci.main_clinical_problem,
      problemStatus: ci.problem_status,
      diagnosticHypothesis: parseJson(ci.diagnostic_hypothesis),
      requestedTests: parseJson(ci.requested_tests),
      treatmentPlan: parseJson(ci.treatment_plan),
      patientEducation: parseJson(ci.patient_education),
      warningSigns: parseJson(ci.warning_signs),
      followUpPlan: parseJson(ci.follow_up_plan),
    },
    jobs,
    simulation: simulation && { ...simulation, voices: parseJson(simulation.voices) },
    asr: await getJson(s.video_s3_key.replace(/\.[^.]+$/, "_transcript.json")),
    reference: s.is_simulated ? await getJson(`${s.user_id}/${s.id}/simulated_transcript.json`) : null,
  });
}

process.stdout.write(JSON.stringify(out, null, 2));
