import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import * as usersApi from "@/api/users.api";
import type { CreateUserInput, UpdateUserInput } from "@mrp/shared";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";

export function useUsers() {
  return useQuery({
    queryKey: ["users"],
    queryFn: () => usersApi.listUsers(),
  });
}

export function useCreateUser() {
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: (input: CreateUserInput) => usersApi.createUser(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      toast.success(t("users.createSuccess"));
    },
    onError: (error: Error) => {
      toast.error(error.message || t("users.createError"));
    },
  });
}

export function useUpdateUser() {
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateUserInput }) =>
      usersApi.updateUser(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      toast.success(t("users.updateSuccess"));
    },
    onError: (error: Error) => {
      toast.error(error.message || t("users.updateError"));
    },
  });
}

export function useDeleteUser() {
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: (id: string) => usersApi.deleteUser(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      toast.success(t("users.deleteSuccess"));
    },
    onError: (error: Error) => {
      toast.error(error.message || t("users.deleteError"));
    },
  });
}
