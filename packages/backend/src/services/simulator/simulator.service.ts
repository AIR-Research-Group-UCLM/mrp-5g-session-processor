import { v4 as uuidv4 } from "uuid";
import { getDb } from "../../db/connection.js";
import { logger } from "../../config/logger.js";
import { simulatorQueue } from "./simulator-queue.service.js";
import type {
  CreateSimulatedSessionInput,
  Simulation,
  SimulationProgress,
  SimulationStatus,
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

export function getSimulation(simulationId: string): Simulation | null {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM simulations WHERE id = ?")
    .get(simulationId) as DbSimulation | undefined;

  return row ? mapDbSimulation(row) : null;
}

export function getSimulationProgress(simulationId: string): SimulationProgress | null {
  const simulation = getSimulation(simulationId);
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

export const simulatorService = {
  startSimulation,
  getSimulation,
  getSimulationProgress,
  updateSimulationStatus,
  incrementCompletedSegments,
};
