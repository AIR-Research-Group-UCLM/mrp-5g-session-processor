import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import * as apiKeysApi from "@/api/api-keys.api";
import type { CreateApiKeyInput } from "@mrp/shared";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";

export function useApiKeys(userId: string | null) {
  return useQuery({
    queryKey: ["api-keys", userId],
    queryFn: () => apiKeysApi.listApiKeys(userId!),
    enabled: !!userId,
  });
}

export function useCreateApiKey() {
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: ({ userId, input }: { userId: string; input: CreateApiKeyInput }) =>
      apiKeysApi.createApiKey(userId, input),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["api-keys", variables.userId] });
      queryClient.invalidateQueries({ queryKey: ["users"] });
      toast.success(t("apiKeys.createSuccess"));
    },
    onError: (error: Error) => {
      toast.error(error.message || t("apiKeys.createError"));
    },
  });
}

export function useRevokeApiKey() {
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: ({ userId, keyId }: { userId: string; keyId: string }) =>
      apiKeysApi.revokeApiKey(userId, keyId),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["api-keys", variables.userId] });
      queryClient.invalidateQueries({ queryKey: ["users"] });
      toast.success(t("apiKeys.revokeSuccess"));
    },
    onError: (error: Error) => {
      toast.error(error.message || t("apiKeys.revokeError"));
    },
  });
}
