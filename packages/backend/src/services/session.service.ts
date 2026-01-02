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
  ProcessingTimeline,
  ProcessingStepTiming,
  SimulationTimeline,
  CreateSessionInput,
  UpdateSessionInput,
  ClinicalIndicators,
  JobType,
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
  is_simulated: number;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
  processing_cost_usd: number | null;
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
  input_tokens: number | null;
  output_tokens: number | null;
  audio_duration_seconds: number | null;
  cost_usd: number | null;
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

interface DbSimulationTiming {
  created_at: string;
  completed_at: string | null;
  conversation_started_at: string | null;
  conversation_completed_at: string | null;
  audio_started_at: string | null;
  audio_completed_at: string | null;
  concatenation_started_at: string | null;
  concatenation_completed_at: string | null;
  // Cost fields
  conversation_input_tokens: number | null;
  conversation_output_tokens: number | null;
  conversation_cost_usd: number | null;
  elevenlabs_characters: number | null;
  elevenlabs_cost_usd: number | null;
  total_cost_usd: number | null;
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
    isSimulated: row.is_simulated === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    processingCostUsd: row.processing_cost_usd,
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

function calculateDurationMs(startedAt: string | null, completedAt: string | null): number | null {
  if (!startedAt || !completedAt) return null;
  return new Date(completedAt).getTime() - new Date(startedAt).getTime();
}

function buildProcessingTimeline(jobs: DbProcessingJob[]): ProcessingTimeline | null {
  if (jobs.length === 0) return null;

  const jobTypes: JobType[] = ["transcribe", "segment", "generate-metadata", "complete"];
  const steps: ProcessingStepTiming[] = jobTypes.map((type) => {
    const job = jobs.find((j) => j.job_type === type);
    const startedAt = job?.started_at ?? null;
    const completedAt = job?.completed_at ?? null;
    return {
      type,
      status: (job?.status ?? "pending") as ProcessingStepTiming["status"],
      startedAt,
      completedAt,
      durationMs: calculateDurationMs(startedAt, completedAt),
      inputTokens: job?.input_tokens ?? null,
      outputTokens: job?.output_tokens ?? null,
      audioDurationSeconds: job?.audio_duration_seconds ?? null,
      costUsd: job?.cost_usd ?? null,
    };
  });

  // Calculate total duration as sum of individual steps (not wall-clock time)
  const totalDurationMs = steps.reduce((sum, step) => sum + (step.durationMs ?? 0), 0) || null;

  // Calculate total cost from all jobs
  const totalCostUsd = jobs.reduce((sum, job) => sum + (job.cost_usd ?? 0), 0) || null;

  return {
    steps,
    totalDurationMs,
    totalCostUsd,
  };
}

function buildSimulationTimeline(simulation: DbSimulationTiming): SimulationTimeline | null {
  const conversationDurationMs = calculateDurationMs(
    simulation.conversation_started_at,
    simulation.conversation_completed_at
  );
  const audioDurationMs = calculateDurationMs(
    simulation.audio_started_at,
    simulation.audio_completed_at
  );
  const concatenationDurationMs = calculateDurationMs(
    simulation.concatenation_started_at,
    simulation.concatenation_completed_at
  );

  // Calculate total as sum of individual steps (not wall-clock time)
  const totalDurationMs =
    (conversationDurationMs ?? 0) + (audioDurationMs ?? 0) + (concatenationDurationMs ?? 0) || null;

  return {
    conversationDurationMs,
    audioDurationMs,
    concatenationDurationMs,
    totalDurationMs,
    // Cost fields
    conversationInputTokens: simulation.conversation_input_tokens,
    conversationOutputTokens: simulation.conversation_output_tokens,
    conversationCostUsd: simulation.conversation_cost_usd,
    elevenlabsCharacters: simulation.elevenlabs_characters,
    elevenlabsCostUsd: simulation.elevenlabs_cost_usd,
    totalCostUsd: simulation.total_cost_usd,
  };
}

interface ListOptions {
  page: number;
  pageSize: number;
  status?: string;
  search?: string;
}

interface DbSessionWithSimulation extends DbSession {
  sim_conversation_started_at: string | null;
  sim_conversation_completed_at: string | null;
  sim_audio_started_at: string | null;
  sim_audio_completed_at: string | null;
  sim_concatenation_started_at: string | null;
  sim_concatenation_completed_at: string | null;
  sim_total_cost_usd: number | null;
}

async function listByUser(
  userId: string,
  options: ListOptions
): Promise<{ sessions: SessionListItem[]; total: number; page: number; pageSize: number }> {
  const db = getDb();
  const { page, pageSize, status } = options;
  const offset = (page - 1) * pageSize;

  // Get user's role for canWrite calculation
  const user = db
    .prepare("SELECT role FROM users WHERE id = ?")
    .get(userId) as { role: string } | undefined;
  const userRole = user?.role ?? "readonly";

  // Query includes both owned and assigned sessions
  let query = `
    SELECT
      ms.id, ms.title, ms.status, ms.summary, ms.keywords, ms.user_tags,
      ms.video_duration_seconds, ms.language, ms.is_simulated, ms.created_at,
      ms.started_at, ms.completed_at, ms.processing_cost_usd, ms.user_id,
      s.conversation_started_at as sim_conversation_started_at,
      s.conversation_completed_at as sim_conversation_completed_at,
      s.audio_started_at as sim_audio_started_at,
      s.audio_completed_at as sim_audio_completed_at,
      s.concatenation_started_at as sim_concatenation_started_at,
      s.concatenation_completed_at as sim_concatenation_completed_at,
      s.total_cost_usd as sim_total_cost_usd,
      CASE WHEN ms.user_id = ? THEN 1 ELSE 0 END as is_owner,
      CASE WHEN sa.id IS NOT NULL THEN 1 ELSE 0 END as is_assigned,
      sa.can_write as assignment_can_write
    FROM medical_sessions ms
    LEFT JOIN simulations s ON s.session_id = ms.id
    LEFT JOIN session_assignments sa ON sa.session_id = ms.id AND sa.user_id = ?
    WHERE (ms.user_id = ? OR sa.user_id = ?)
  `;
  const params: (string | number)[] = [userId, userId, userId, userId];

  if (status) {
    query += " AND ms.status = ?";
    params.push(status);
  }

  query += " ORDER BY ms.created_at DESC LIMIT ? OFFSET ?";
  params.push(pageSize, offset);

  const rows = db.prepare(query).all(...params) as (DbSessionWithSimulation & {
    user_id: string;
    is_owner: number;
    is_assigned: number;
    assignment_can_write: number | null;
  })[];

  // Count query also includes assigned sessions
  const countQuery = status
    ? `SELECT COUNT(DISTINCT ms.id) as count FROM medical_sessions ms
       LEFT JOIN session_assignments sa ON sa.session_id = ms.id AND sa.user_id = ?
       WHERE (ms.user_id = ? OR sa.user_id = ?) AND ms.status = ?`
    : `SELECT COUNT(DISTINCT ms.id) as count FROM medical_sessions ms
       LEFT JOIN session_assignments sa ON sa.session_id = ms.id AND sa.user_id = ?
       WHERE (ms.user_id = ? OR sa.user_id = ?)`;
  const countParams = status ? [userId, userId, userId, status] : [userId, userId, userId];
  const { count } = db.prepare(countQuery).get(...countParams) as { count: number };

  const sessions: SessionListItem[] = rows.map((row) => {
    const startedAt = row.started_at;
    const completedAt = row.completed_at;
    const processingDurationMs =
      startedAt && completedAt
        ? new Date(completedAt).getTime() - new Date(startedAt).getTime()
        : null;

    // Calculate simulation duration from its timestamps
    let simulationDurationMs: number | null = null;
    if (row.sim_conversation_started_at && row.sim_concatenation_completed_at) {
      simulationDurationMs =
        new Date(row.sim_concatenation_completed_at).getTime() -
        new Date(row.sim_conversation_started_at).getTime();
    }

    const simulationCostUsd = row.sim_total_cost_usd;
    const processingCostUsd = row.processing_cost_usd;

    // Calculate totals
    const totalDurationMs =
      processingDurationMs !== null || simulationDurationMs !== null
        ? (processingDurationMs ?? 0) + (simulationDurationMs ?? 0)
        : null;

    const totalCostUsd =
      processingCostUsd !== null || simulationCostUsd !== null
        ? (processingCostUsd ?? 0) + (simulationCostUsd ?? 0)
        : null;

    // Calculate access permissions
    const isOwner = row.is_owner === 1;
    const isAssigned = row.is_assigned === 1;
    // canWrite: owner always can write, assigned users need assignment.can_write=1 AND role != readonly
    const canWrite = isOwner || (isAssigned && row.assignment_can_write === 1 && userRole !== "readonly");

    return {
      id: row.id,
      title: row.title,
      status: row.status as SessionListItem["status"],
      summary: row.summary,
      keywords: row.keywords ? JSON.parse(row.keywords) : null,
      userTags: row.user_tags ? JSON.parse(row.user_tags) : null,
      videoDurationSeconds: row.video_duration_seconds,
      language: row.language,
      isSimulated: row.is_simulated === 1,
      createdAt: row.created_at,
      startedAt,
      completedAt,
      processingDurationMs,
      processingCostUsd,
      simulationDurationMs,
      simulationCostUsd,
      totalDurationMs,
      totalCostUsd,
      isOwner,
      isAssigned,
      canWrite,
    };
  });

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
  sessionId: string
): Promise<{ session: SessionWithTranscript; videoUrl: string | null } | null> {
  const db = getDb();

  // Access validation is done by middleware, just fetch by ID
  const sessionRow = db
    .prepare("SELECT * FROM medical_sessions WHERE id = ?")
    .get(sessionId) as DbSession | undefined;

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

  // Get processing jobs for timeline
  const processingJobs = db
    .prepare("SELECT * FROM processing_jobs WHERE session_id = ? ORDER BY created_at")
    .all(sessionId) as DbProcessingJob[];

  // Get simulation timing if this is a simulated session
  let simulationTimeline: SimulationTimeline | null = null;
  if (sessionRow.is_simulated === 1) {
    const simulationRow = db
      .prepare(`
        SELECT created_at, completed_at, conversation_started_at, conversation_completed_at,
               audio_started_at, audio_completed_at, concatenation_started_at, concatenation_completed_at,
               conversation_input_tokens, conversation_output_tokens, conversation_cost_usd,
               elevenlabs_characters, elevenlabs_cost_usd, total_cost_usd
        FROM simulations WHERE session_id = ?
      `)
      .get(sessionId) as DbSimulationTiming | undefined;

    if (simulationRow) {
      simulationTimeline = buildSimulationTimeline(simulationRow);
    }
  }

  const session = mapDbSession(sessionRow);
  const transcript = transcriptRows.map(mapDbTranscriptSection);
  const sectionSummaries = summaryRows.map(mapDbSectionSummary);
  const clinicalIndicators = indicatorsRow ? mapDbClinicalIndicators(indicatorsRow) : null;
  const processingTimeline = buildProcessingTimeline(processingJobs);

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
      processingTimeline,
      simulationTimeline,
    },
    videoUrl,
  };
}

async function getProcessingStatus(
  sessionId: string
): Promise<ProcessingProgress | null> {
  const db = getDb();

  // Access validation is done by middleware, just fetch by ID
  const sessionRow = db
    .prepare("SELECT status, error_message, started_at, completed_at FROM medical_sessions WHERE id = ?")
    .get(sessionId) as { status: string; error_message: string | null; started_at: string | null; completed_at: string | null } | undefined;

  if (!sessionRow) {
    return null;
  }

  const jobs = db
    .prepare(
      "SELECT * FROM processing_jobs WHERE session_id = ? ORDER BY created_at"
    )
    .all(sessionId) as DbProcessingJob[];

  const jobTypes: JobType[] = ["transcribe", "segment", "generate-metadata", "complete"];
  const steps: ProcessingStepTiming[] = jobTypes.map((type) => {
    const job = jobs.find((j) => j.job_type === type);
    const startedAt = job?.started_at ?? null;
    const completedAt = job?.completed_at ?? null;
    return {
      type,
      status: (job?.status ?? "pending") as ProcessingStepTiming["status"],
      startedAt,
      completedAt,
      durationMs: calculateDurationMs(startedAt, completedAt),
      inputTokens: job?.input_tokens ?? null,
      outputTokens: job?.output_tokens ?? null,
      audioDurationSeconds: job?.audio_duration_seconds ?? null,
      costUsd: job?.cost_usd ?? null,
    };
  });

  const currentJob = jobs.find((j) => j.status === "processing");

  // Calculate total cost from all jobs
  const totalCostUsd = jobs.reduce((sum, job) => sum + (job.cost_usd ?? 0), 0) || null;

  return {
    sessionId,
    status: sessionRow.status as ProcessingProgress["status"],
    currentStep: (currentJob?.job_type as ProcessingProgress["currentStep"]) ?? null,
    steps,
    errorMessage: sessionRow.error_message,
    totalDurationMs: calculateDurationMs(sessionRow.started_at, sessionRow.completed_at),
    totalCostUsd,
    startedAt: sessionRow.started_at,
    completedAt: sessionRow.completed_at,
  };
}

async function update(
  sessionId: string,
  input: UpdateSessionInput
): Promise<MedicalSession | null> {
  const db = getDb();

  // Access validation is done by middleware, just check existence
  const existing = db
    .prepare("SELECT id FROM medical_sessions WHERE id = ?")
    .get(sessionId);

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

async function deleteSession(sessionId: string): Promise<boolean> {
  const db = getDb();

  // Access validation (owner-only for delete) is done by middleware
  const session = db
    .prepare("SELECT video_s3_key FROM medical_sessions WHERE id = ?")
    .get(sessionId) as { video_s3_key: string | null } | undefined;

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

async function getVideoUrl(sessionId: string): Promise<string | null> {
  const db = getDb();

  // Access validation is done by middleware
  const session = db
    .prepare("SELECT video_s3_key FROM medical_sessions WHERE id = ?")
    .get(sessionId) as { video_s3_key: string | null } | undefined;

  if (!session?.video_s3_key) {
    return null;
  }

  return s3Service.getPresignedUrl(session.video_s3_key);
}

async function getVideoS3Key(sessionId: string): Promise<string | null> {
  const db = getDb();

  // Access validation is done by middleware
  const session = db
    .prepare("SELECT video_s3_key FROM medical_sessions WHERE id = ?")
    .get(sessionId) as { video_s3_key: string | null } | undefined;

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
