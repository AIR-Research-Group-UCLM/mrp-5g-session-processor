import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import * as assignmentsApi from "@/api/assignments.api";
import type { AssignmentInput } from "@mrp/shared";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";

export function useAvailableSessions(userId: string | null) {
  return useQuery({
    queryKey: ["available-sessions", userId],
    queryFn: () => assignmentsApi.getAvailableSessions(userId!),
    enabled: !!userId,
  });
}

export function useUserAssignments(userId: string | null) {
  return useQuery({
    queryKey: ["user-assignments", userId],
    queryFn: () => assignmentsApi.getUserAssignments(userId!),
    enabled: !!userId,
  });
}

export function useSetUserAssignments() {
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: ({
      userId,
      assignments,
    }: {
      userId: string;
      assignments: AssignmentInput[];
    }) => assignmentsApi.setUserAssignments(userId, assignments),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["user-assignments", variables.userId],
      });
      queryClient.invalidateQueries({
        queryKey: ["available-sessions", variables.userId],
      });
      toast.success(t("assignments.updateSuccess"));
    },
    onError: (error: Error) => {
      toast.error(error.message || t("assignments.updateError"));
    },
  });
}
