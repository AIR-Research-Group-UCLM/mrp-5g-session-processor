import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as simulatorApi from "@/api/simulator.api";
import type { CreateSimulatedSessionInput } from "@mrp/shared";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";

export function useSimulatorVoices() {
  return useQuery({
    queryKey: ["simulator-voices"],
    queryFn: () => simulatorApi.getSimulatorVoices(),
    staleTime: Infinity, // Voices don't change during a session
  });
}

export function useStartSimulation() {
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: (input: CreateSimulatedSessionInput) =>
      simulatorApi.startSimulation(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
    onError: (error: Error) => {
      toast.error(error.message || t("simulator.error"));
    },
  });
}

export function useSimulationStatus(
  simulationId: string | null,
  enabled: boolean = true
) {
  return useQuery({
    queryKey: ["simulation", simulationId],
    queryFn: () => simulatorApi.getSimulationStatus(simulationId!),
    enabled: enabled && !!simulationId,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      // Stop polling when completed or failed
      if (status === "completed" || status === "failed") {
        return false;
      }
      // Poll every 2 seconds while in progress
      return 2000;
    },
  });
}

export function useGenerateContextSuggestion() {
  const { t } = useTranslation();

  return useMutation({
    mutationFn: (language: string) =>
      simulatorApi.generateContextSuggestion(language),
    onError: (error: Error) => {
      toast.error(error.message || t("simulator.autoCompleteError"));
    },
  });
}
