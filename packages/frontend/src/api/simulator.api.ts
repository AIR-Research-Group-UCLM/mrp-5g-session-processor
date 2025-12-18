import { apiClient } from "./client";
import type { CreateSimulatedSessionInput, SimulationProgress, SimulatorVoice } from "@mrp/shared";

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export async function getSimulatorVoices(): Promise<SimulatorVoice[]> {
  const response = await apiClient.get<
    ApiResponse<SimulatorVoice[]>
  >("/simulator/voices");

  if (!response.data.data) {
    throw new Error(response.data.error ?? "Failed to get simulator voices");
  }
  return response.data.data;
}

export async function startSimulation(
  input: CreateSimulatedSessionInput
): Promise<{ simulationId: string }> {
  const response = await apiClient.post<
    ApiResponse<{ simulationId: string }>
  >("/simulator", input);

  if (!response.data.data) {
    throw new Error(response.data.error ?? "Failed to start simulation");
  }
  return response.data.data;
}

export async function getSimulationStatus(
  simulationId: string
): Promise<SimulationProgress> {
  const response = await apiClient.get<
    ApiResponse<SimulationProgress>
  >(`/simulator/${simulationId}/status`);

  if (!response.data.data) {
    throw new Error(response.data.error ?? "Failed to get simulation status");
  }
  return response.data.data;
}
