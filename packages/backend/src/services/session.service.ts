import { v4 as uuidv4 } from "uuid";
import { getDb } from "../db/connection.js";
import { s3Service } from "./s3.service.js";
import { queueService } from "./processing/queue.service.js";
import { logger } from "../config/logger.js";
import type {
  MedicalSession,
  SessionListItem,
  SessionWithTranscript,
  TranscriptSection,
  SectionSummary,
  ProcessingProgress,
  CreateSessionInput,
  UpdateSessionInput,
  ClinicalIndicators,
} from "@mrp/shared";
import fs from "node:fs/promises";

interface DbSession {
  id: string;
  user_id: string;
  title: string | null;
  status: string;
  video_s3_key: string | null;
  video_original_name: string | null;
  video_duration_seconds: number | null;
  video_size_bytes: number | null;
  video_mime_type: string | null;
  language: string | null;
  summary: string | null;
  keywords: string | null;
  user_tags: string | null;
  notes: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

interface DbTranscriptSection {
  id: string;
  session_id: string;
  section_type: string;
  section_order: number;
  speaker: string | null;
  content: string;
  start_time_seconds: number | null;
  end_time_seconds: number | null;
  created_at: string;
}

interface DbProcessingJob {
  id: string;
  session_id: string;
  job_type: string;
  status: string;
  priority: number;
  attempts: number;
  max_attempts: number;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

interface DbSectionSummary {
  id: string;
  session_id: string;
  section_type: string;
  summary: string;
  created_at: string;
}

interface DbClinicalIndicators {
  id: string;
  session_id: string;
  urgency_level: string | null;
  appointment_priority: string | null;
  reason_for_visit: string | null;
  consulted_specialty: string | null;
  main_clinical_problem: string | null;
  problem_status: string | null;
  diagnostic_hypothesis: string | null;
  requested_tests: string | null;
  treatment_plan: string | null;
  patient_education: string | null;
  warning_signs: string | null;
  follow_up_plan: string | null;
  created_at: string;
  updated_at: string;
}

function mapDbSession(row: DbSession): MedicalSession {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    status: row.status as MedicalSession["status"],
    videoS3Key: row.video_s3_key,
    videoOriginalName: row.video_original_name,
    videoDurationSeconds: row.video_duration_seconds,
    videoSizeBytes: row.video_size_bytes,
    videoMimeType: row.video_mime_type,
    language: row.language,
    summary: row.summary,
    keywords: row.keywords ? JSON.parse(row.keywords) : null,
    userTags: row.user_tags ? JSON.parse(row.user_tags) : null,
    notes: row.notes,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

function mapDbTranscriptSection(row: DbTranscriptSection): TranscriptSection {
  return {
    id: row.id,
    sessionId: row.session_id,
    sectionType: row.section_type as TranscriptSection["sectionType"],
    sectionOrder: row.section_order,
    speaker: row.speaker,
    content: row.content,
    startTimeSeconds: row.start_time_seconds,
    endTimeSeconds: row.end_time_seconds,
    createdAt: row.created_at,
  };
}

function mapDbSectionSummary(row: DbSectionSummary): SectionSummary {
  return {
    id: row.id,
    sessionId: row.session_id,
    sectionType: row.section_type as SectionSummary["sectionType"],
    summary: row.summary,
    createdAt: row.created_at,
  };
}

function mapDbClinicalIndicators(row: DbClinicalIndicators): ClinicalIndicators {
  return {
    id: row.id,
    sessionId: row.session_id,
    urgencyLevel: row.urgency_level as ClinicalIndicators["urgencyLevel"],
    appointmentPriority: row.appointment_priority as ClinicalIndicators["appointmentPriority"],
    reasonForVisit: row.reason_for_visit,
    consultedSpecialty: row.consulted_specialty,
    mainClinicalProblem: row.main_clinical_problem,
    problemStatus: row.problem_status as ClinicalIndicators["problemStatus"],
    diagnosticHypothesis: row.diagnostic_hypothesis ? JSON.parse(row.diagnostic_hypothesis) : null,
    requestedTests: row.requested_tests ? JSON.parse(row.requested_tests) : null,
    treatmentPlan: row.treatment_plan ? JSON.parse(row.treatment_plan) : null,
    patientEducation: row.patient_education ? JSON.parse(row.patient_education) : null,
    warningSigns: row.warning_signs ? JSON.parse(row.warning_signs) : null,
    followUpPlan: row.follow_up_plan ? JSON.parse(row.follow_up_plan) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

interface ListOptions {
  page: number;
  pageSize: number;
  status?: string;
  search?: string;
}

async function listByUser(
  userId: string,
  options: ListOptions
): Promise<{ sessions: SessionListItem[]; total: number; page: number; pageSize: number }> {
  const db = getDb();
  const { page, pageSize, status } = options;
  const offset = (page - 1) * pageSize;

  let query = `
    SELECT id, title, status, summary, keywords, user_tags, video_duration_seconds, language, created_at, completed_at
    FROM medical_sessions
    WHERE user_id = ?
  `;
  const params: (string | number)[] = [userId];

  if (status) {
    query += " AND status = ?";
    params.push(status);
  }

  query += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
  params.push(pageSize, offset);

  const rows = db.prepare(query).all(...params) as DbSession[];

  const countQuery = status
    ? "SELECT COUNT(*) as count FROM medical_sessions WHERE user_id = ? AND status = ?"
    : "SELECT COUNT(*) as count FROM medical_sessions WHERE user_id = ?";
  const countParams = status ? [userId, status] : [userId];
  const { count } = db.prepare(countQuery).get(...countParams) as { count: number };

  const sessions: SessionListItem[] = rows.map((row) => ({
    id: row.id,
    title: row.title,
    status: row.status as SessionListItem["status"],
    summary: row.summary,
    keywords: row.keywords ? JSON.parse(row.keywords) : null,
    userTags: row.user_tags ? JSON.parse(row.user_tags) : null,
    videoDurationSeconds: row.video_duration_seconds,
    language: row.language,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  }));

  return {
    sessions,
    total: count,
    page,
    pageSize,
  };
}

async function create(
  userId: string,
  file: Express.Multer.File,
  input: CreateSessionInput
): Promise<MedicalSession> {
  const db = getDb();
  const sessionId = uuidv4();
  const videoS3Key = s3Service.getVideoKey(userId, sessionId, file.originalname);

  await s3Service.uploadFile(videoS3Key, file.path, file.mimetype);

  await fs.unlink(file.path);

  const stmt = db.prepare(`
    INSERT INTO medical_sessions (
      id, user_id, title, status, video_s3_key, video_original_name,
      video_size_bytes, video_mime_type, user_tags, notes
    ) VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    sessionId,
    userId,
    input.title ?? null,
    videoS3Key,
    file.originalname,
    file.size,
    file.mimetype,
    input.userTags ? JSON.stringify(input.userTags) : null,
    input.notes ?? null
  );

  await queueService.enqueueProcessing(sessionId);

  logger.info({ sessionId, userId }, "Session created and processing queued");

  const row = db
    .prepare("SELECT * FROM medical_sessions WHERE id = ?")
    .get(sessionId) as DbSession;

  return mapDbSession(row);
}

async function getByIdWithTranscript(
  userId: string,
  sessionId: string
): Promise<{ session: SessionWithTranscript; videoUrl: string | null } | null> {
  const db = getDb();

  const sessionRow = db
    .prepare("SELECT * FROM medical_sessions WHERE id = ? AND user_id = ?")
    .get(sessionId, userId) as DbSession | undefined;

  if (!sessionRow) {
    return null;
  }

  const transcriptRows = db
    .prepare(
      "SELECT * FROM transcript_sections WHERE session_id = ? ORDER BY section_order"
    )
    .all(sessionId) as DbTranscriptSection[];

  const summaryRows = db
    .prepare("SELECT * FROM section_summaries WHERE session_id = ?")
    .all(sessionId) as DbSectionSummary[];

  const indicatorsRow = db
    .prepare("SELECT * FROM clinical_indicators WHERE session_id = ?")
    .get(sessionId) as DbClinicalIndicators | undefined;

  const session = mapDbSession(sessionRow);
  const transcript = transcriptRows.map(mapDbTranscriptSection);
  const sectionSummaries = summaryRows.map(mapDbSectionSummary);
  const clinicalIndicators = indicatorsRow ? mapDbClinicalIndicators(indicatorsRow) : null;

  let videoUrl: string | null = null;
  if (session.videoS3Key) {
    videoUrl = await s3Service.getPresignedUrl(session.videoS3Key);
  }

  return {
    session: {
      ...session,
      transcript,
      sectionSummaries,
      clinicalIndicators,
    },
    videoUrl,
  };
}

async function getProcessingStatus(
  userId: string,
  sessionId: string
): Promise<ProcessingProgress | null> {
  const db = getDb();

  const sessionRow = db
    .prepare("SELECT status, error_message FROM medical_sessions WHERE id = ? AND user_id = ?")
    .get(sessionId, userId) as { status: string; error_message: string | null } | undefined;

  if (!sessionRow) {
    return null;
  }

  const jobs = db
    .prepare(
      "SELECT * FROM processing_jobs WHERE session_id = ? ORDER BY created_at"
    )
    .all(sessionId) as DbProcessingJob[];

  const jobTypes = ["transcribe", "segment", "generate-metadata", "complete"] as const;
  const steps = jobTypes.map((type) => {
    const job = jobs.find((j) => j.job_type === type);
    return {
      type,
      status: (job?.status ?? "pending") as ProcessingProgress["status"],
    };
  });

  const currentJob = jobs.find((j) => j.status === "processing");

  return {
    sessionId,
    status: sessionRow.status as ProcessingProgress["status"],
    currentStep: currentJob?.job_type as ProcessingProgress["currentStep"] ?? null,
    steps,
    errorMessage: sessionRow.error_message,
  };
}

async function update(
  userId: string,
  sessionId: string,
  input: UpdateSessionInput
): Promise<MedicalSession | null> {
  const db = getDb();

  const existing = db
    .prepare("SELECT id FROM medical_sessions WHERE id = ? AND user_id = ?")
    .get(sessionId, userId);

  if (!existing) {
    return null;
  }

  const updates: string[] = [];
  const params: (string | null)[] = [];

  if (input.title !== undefined) {
    updates.push("title = ?");
    params.push(input.title);
  }

  if (input.userTags !== undefined) {
    updates.push("user_tags = ?");
    params.push(JSON.stringify(input.userTags));
  }

  if (input.notes !== undefined) {
    updates.push("notes = ?");
    params.push(input.notes);
  }

  if (updates.length > 0) {
    updates.push("updated_at = datetime('now')");
    params.push(sessionId);

    db.prepare(
      `UPDATE medical_sessions SET ${updates.join(", ")} WHERE id = ?`
    ).run(...params);
  }

  const row = db
    .prepare("SELECT * FROM medical_sessions WHERE id = ?")
    .get(sessionId) as DbSession;

  return mapDbSession(row);
}

async function deleteSession(userId: string, sessionId: string): Promise<boolean> {
  const db = getDb();

  const session = db
    .prepare("SELECT video_s3_key FROM medical_sessions WHERE id = ? AND user_id = ?")
    .get(sessionId, userId) as { video_s3_key: string | null } | undefined;

  if (!session) {
    return false;
  }

  if (session.video_s3_key) {
    try {
      await s3Service.deleteFile(session.video_s3_key);
    } catch (error) {
      logger.error({ error, sessionId }, "Failed to delete video from S3");
    }
  }

  db.prepare("DELETE FROM medical_sessions WHERE id = ?").run(sessionId);

  return true;
}

async function getVideoUrl(userId: string, sessionId: string): Promise<string | null> {
  const db = getDb();

  const session = db
    .prepare("SELECT video_s3_key FROM medical_sessions WHERE id = ? AND user_id = ?")
    .get(sessionId, userId) as { video_s3_key: string | null } | undefined;

  if (!session?.video_s3_key) {
    return null;
  }

  return s3Service.getPresignedUrl(session.video_s3_key);
}

async function getVideoS3Key(userId: string, sessionId: string): Promise<string | null> {
  const db = getDb();

  const session = db
    .prepare("SELECT video_s3_key FROM medical_sessions WHERE id = ? AND user_id = ?")
    .get(sessionId, userId) as { video_s3_key: string | null } | undefined;

  return session?.video_s3_key ?? null;
}

export const sessionService = {
  listByUser,
  create,
  getByIdWithTranscript,
  getProcessingStatus,
  update,
  delete: deleteSession,
  getVideoUrl,
  getVideoS3Key,
};
