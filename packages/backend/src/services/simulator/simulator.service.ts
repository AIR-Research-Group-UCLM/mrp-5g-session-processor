import { v4 as uuidv4 } from "uuid";
import { getDb } from "../../db/connection.js";
import { logger } from "../../config/logger.js";
import { simulatorQueue } from "./simulator-queue.service.js";
import type {
  CreateSimulatedSessionInput,
  Simulation,
  SimulationProgress,
  SimulationStatus,
  SimulatorTimeline,
  SimulatorVoiceSelection,
} from "@mrp/shared";

interface DbSimulation {
  id: string;
  user_id: string;
  status: SimulationStatus;
  current_step: string | null;
  total_segments: number | null;
  completed_segments: number;
  context: string;
  language: string;
  voices: string;
  title: string | null;
  user_tags: string | null;
  notes: string | null;
  session_id: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
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

function mapDbSimulation(row: DbSimulation): Simulation {
  return {
    id: row.id,
    userId: row.user_id,
    status: row.status,
    currentStep: row.current_step as Simulation["currentStep"],
    totalSegments: row.total_segments,
    completedSegments: row.completed_segments,
    context: row.context,
    language: row.language,
    voices: JSON.parse(row.voices) as SimulatorVoiceSelection,
    title: row.title,
    userTags: row.user_tags ? JSON.parse(row.user_tags) : null,
    notes: row.notes,
    sessionId: row.session_id,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
    conversationStartedAt: row.conversation_started_at,
    conversationCompletedAt: row.conversation_completed_at,
    audioStartedAt: row.audio_started_at,
    audioCompletedAt: row.audio_completed_at,
    concatenationStartedAt: row.concatenation_started_at,
    concatenationCompletedAt: row.concatenation_completed_at,
    // Cost fields
    conversationInputTokens: row.conversation_input_tokens,
    conversationOutputTokens: row.conversation_output_tokens,
    conversationCostUsd: row.conversation_cost_usd,
    elevenlabsCharacters: row.elevenlabs_characters,
    elevenlabsCostUsd: row.elevenlabs_cost_usd,
    totalCostUsd: row.total_cost_usd,
  };
}

function calculateDurationMs(startedAt: string | null, completedAt: string | null): number | null {
  if (!startedAt || !completedAt) return null;
  return new Date(completedAt).getTime() - new Date(startedAt).getTime();
}

function buildSimulatorTimeline(simulation: Simulation): SimulatorTimeline | null {
  return {
    conversationDurationMs: calculateDurationMs(
      simulation.conversationStartedAt,
      simulation.conversationCompletedAt
    ),
    audioDurationMs: calculateDurationMs(
      simulation.audioStartedAt,
      simulation.audioCompletedAt
    ),
    concatenationDurationMs: calculateDurationMs(
      simulation.concatenationStartedAt,
      simulation.concatenationCompletedAt
    ),
    totalDurationMs: calculateDurationMs(
      simulation.createdAt,
      simulation.completedAt
    ),
    // Cost fields
    conversationInputTokens: simulation.conversationInputTokens,
    conversationOutputTokens: simulation.conversationOutputTokens,
    conversationCostUsd: simulation.conversationCostUsd,
    elevenlabsCharacters: simulation.elevenlabsCharacters,
    elevenlabsCostUsd: simulation.elevenlabsCostUsd,
    totalCostUsd: simulation.totalCostUsd,
  };
}

export async function startSimulation(
  userId: string,
  input: CreateSimulatedSessionInput
): Promise<{ simulationId: string }> {
  const simulationId = uuidv4();
  const db = getDb();

  // Insert simulation record
  db.prepare(
    `
    INSERT INTO simulations (
      id, user_id, status, context, language, voices, title, user_tags, notes
    ) VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, ?)
  `
  ).run(
    simulationId,
    userId,
    input.context,
    input.language,
    JSON.stringify(input.voices),
    input.title ?? null,
    input.userTags ? JSON.stringify(input.userTags) : null,
    input.notes ?? null
  );

  // Enqueue the first job
  await simulatorQueue.add(
    "generate-conversation",
    { simulationId, step: "generate-conversation" },
    { jobId: `${simulationId}-conversation` }
  );

  logger.info({ simulationId, userId, language: input.language }, "Simulation started");

  return { simulationId };
}

// Internal function - used by workers where we don't have user context
export function getSimulation(simulationId: string): Simulation | null {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM simulations WHERE id = ?")
    .get(simulationId) as DbSimulation | undefined;

  return row ? mapDbSimulation(row) : null;
}

// Secure function - requires userId to prevent IDOR
export function getSimulationForUser(simulationId: string, userId: string): Simulation | null {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM simulations WHERE id = ? AND user_id = ?")
    .get(simulationId, userId) as DbSimulation | undefined;

  return row ? mapDbSimulation(row) : null;
}

// Secure function - requires userId to prevent IDOR
export function getSimulationProgress(simulationId: string, userId: string): SimulationProgress | null {
  const simulation = getSimulationForUser(simulationId, userId);
  if (!simulation) {
    return null;
  }

  return {
    simulationId: simulation.id,
    status: simulation.status,
    currentStep: simulation.currentStep,
    totalSegments: simulation.totalSegments,
    completedSegments: simulation.completedSegments,
    sessionId: simulation.sessionId,
    errorMessage: simulation.errorMessage,
    timeline: buildSimulatorTimeline(simulation),
  };
}

export function updateSimulationStatus(
  simulationId: string,
  status: SimulationStatus,
  updates?: {
    currentStep?: string | null;
    totalSegments?: number;
    completedSegments?: number;
    sessionId?: string;
    errorMessage?: string;
    conversationStartedAt?: string;
    conversationCompletedAt?: string;
    audioStartedAt?: string;
    audioCompletedAt?: string;
    concatenationStartedAt?: string;
    concatenationCompletedAt?: string;
    completedAt?: string;
    // Cost fields
    conversationInputTokens?: number;
    conversationOutputTokens?: number;
    conversationCostUsd?: number;
    elevenlabsCostUsd?: number;
    totalCostUsd?: number;
  }
): void {
  const db = getDb();

  const setClause = ["status = ?", "updated_at = datetime('now')"];
  const params: (string | number | null)[] = [status];

  if (updates?.currentStep !== undefined) {
    setClause.push("current_step = ?");
    params.push(updates.currentStep);
  }

  if (updates?.totalSegments !== undefined) {
    setClause.push("total_segments = ?");
    params.push(updates.totalSegments);
  }

  if (updates?.completedSegments !== undefined) {
    setClause.push("completed_segments = ?");
    params.push(updates.completedSegments);
  }

  if (updates?.sessionId !== undefined) {
    setClause.push("session_id = ?");
    params.push(updates.sessionId);
  }

  if (updates?.errorMessage !== undefined) {
    setClause.push("error_message = ?");
    params.push(updates.errorMessage);
  }

  if (updates?.conversationStartedAt !== undefined) {
    setClause.push("conversation_started_at = ?");
    params.push(updates.conversationStartedAt);
  }

  if (updates?.conversationCompletedAt !== undefined) {
    setClause.push("conversation_completed_at = ?");
    params.push(updates.conversationCompletedAt);
  }

  if (updates?.audioStartedAt !== undefined) {
    setClause.push("audio_started_at = ?");
    params.push(updates.audioStartedAt);
  }

  if (updates?.audioCompletedAt !== undefined) {
    setClause.push("audio_completed_at = ?");
    params.push(updates.audioCompletedAt);
  }

  if (updates?.concatenationStartedAt !== undefined) {
    setClause.push("concatenation_started_at = ?");
    params.push(updates.concatenationStartedAt);
  }

  if (updates?.concatenationCompletedAt !== undefined) {
    setClause.push("concatenation_completed_at = ?");
    params.push(updates.concatenationCompletedAt);
  }

  if (updates?.completedAt !== undefined) {
    setClause.push("completed_at = ?");
    params.push(updates.completedAt);
  }

  // Cost fields
  if (updates?.conversationInputTokens !== undefined) {
    setClause.push("conversation_input_tokens = ?");
    params.push(updates.conversationInputTokens);
  }

  if (updates?.conversationOutputTokens !== undefined) {
    setClause.push("conversation_output_tokens = ?");
    params.push(updates.conversationOutputTokens);
  }

  if (updates?.conversationCostUsd !== undefined) {
    setClause.push("conversation_cost_usd = ?");
    params.push(updates.conversationCostUsd);
  }

  if (updates?.elevenlabsCostUsd !== undefined) {
    setClause.push("elevenlabs_cost_usd = ?");
    params.push(updates.elevenlabsCostUsd);
  }

  if (updates?.totalCostUsd !== undefined) {
    setClause.push("total_cost_usd = ?");
    params.push(updates.totalCostUsd);
  }

  params.push(simulationId);

  db.prepare(`UPDATE simulations SET ${setClause.join(", ")} WHERE id = ?`).run(...params);
}

export function incrementCompletedSegments(simulationId: string): number {
  const db = getDb();

  db.prepare(
    `
    UPDATE simulations
    SET completed_segments = completed_segments + 1, updated_at = datetime('now')
    WHERE id = ?
  `
  ).run(simulationId);

  const row = db
    .prepare("SELECT completed_segments, total_segments FROM simulations WHERE id = ?")
    .get(simulationId) as { completed_segments: number; total_segments: number } | undefined;

  return row?.completed_segments ?? 0;
}

export function incrementElevenlabsCharacters(simulationId: string, characterCount: number): number {
  const db = getDb();

  db.prepare(
    `
    UPDATE simulations
    SET elevenlabs_characters = COALESCE(elevenlabs_characters, 0) + ?, updated_at = datetime('now')
    WHERE id = ?
  `
  ).run(characterCount, simulationId);

  const row = db
    .prepare("SELECT elevenlabs_characters FROM simulations WHERE id = ?")
    .get(simulationId) as { elevenlabs_characters: number | null } | undefined;

  return row?.elevenlabs_characters ?? 0;
}

export const simulatorService = {
  startSimulation,
  getSimulation,
  getSimulationForUser,
  getSimulationProgress,
  updateSimulationStatus,
  incrementCompletedSegments,
  incrementElevenlabsCharacters,
};
