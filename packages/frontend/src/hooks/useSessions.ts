import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import * as sessionsApi from "@/api/sessions.api";
import type { UpdateSessionInput } from "@mrp/shared";
import toast from "react-hot-toast";

export function useSessions(params?: {
  page?: number;
  pageSize?: number;
  status?: string;
}) {
  return useQuery({
    queryKey: ["sessions", params],
    queryFn: () => sessionsApi.listSessions(params),
  });
}

export function useSession(id: string) {
  return useQuery({
    queryKey: ["session", id],
    queryFn: () => sessionsApi.getSession(id),
    enabled: !!id,
  });
}

export function useSessionStatus(id: string, enabled: boolean = true) {
  return useQuery({
    queryKey: ["session-status", id],
    queryFn: () => sessionsApi.getSessionStatus(id),
    enabled: enabled && !!id,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (data?.status === "completed" || data?.status === "failed") {
        return false;
      }
      return 3000;
    },
  });
}

export function useCreateSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      file,
      metadata,
    }: {
      file: File;
      metadata?: { title?: string; userTags?: string[]; notes?: string };
    }) => sessionsApi.createSession(file, metadata),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
      toast.success("Sesión creada correctamente");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Error al crear la sesión");
    },
  });
}

export function useUpdateSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateSessionInput }) =>
      sessionsApi.updateSession(id, data),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ["session", id] });
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
      toast.success("Sesión actualizada");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Error al actualizar");
    },
  });
}

export function useDeleteSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => sessionsApi.deleteSession(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
      toast.success("Sesión eliminada");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Error al eliminar");
    },
  });
}

export function useSearchSessions(query: string, enabled: boolean = true) {
  return useQuery({
    queryKey: ["search", query],
    queryFn: () => sessionsApi.searchSessions(query),
    enabled: enabled && query.length >= 2,
  });
}
