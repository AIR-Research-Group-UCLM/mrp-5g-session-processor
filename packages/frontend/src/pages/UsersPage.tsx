import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardContent } from "@/components/ui/Card";
import { Spinner } from "@/components/ui/Spinner";
import { Tooltip } from "@/components/ui/Tooltip";
import { UserFormModal } from "@/components/users/UserFormModal";
import {
  useUsers,
  useCreateUser,
  useUpdateUser,
  useDeleteUser,
} from "@/hooks/useUsers";
import type { UserListItem, CreateUserInput, UpdateUserInput } from "@mrp/shared";
import dayjs from "dayjs";

const PROTECTED_EMAIL = "admin@user.com";

export function UsersPage() {
  const { t, i18n } = useTranslation();
  const { data: users, isLoading, error } = useUsers();
  const createUser = useCreateUser();
  const updateUser = useUpdateUser();
  const deleteUser = useDeleteUser();

  const [modalOpen, setModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserListItem | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const handleCreate = () => {
    setEditingUser(null);
    setModalOpen(true);
  };

  const handleEdit = (user: UserListItem) => {
    setEditingUser(user);
    setModalOpen(true);
  };

  const handleModalSubmit = async (data: CreateUserInput | UpdateUserInput) => {
    if (editingUser) {
      await updateUser.mutateAsync({
        id: editingUser.id,
        data: data as UpdateUserInput,
      });
    } else {
      await createUser.mutateAsync(data as CreateUserInput);
    }
    setModalOpen(false);
  };

  const handleDelete = async (id: string) => {
    await deleteUser.mutateAsync(id);
    setDeleteConfirmId(null);
  };

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg bg-red-50 p-4 text-red-700">
        {t("users.loadError")}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">{t("users.title")}</h1>
        <Button onClick={handleCreate}>
          <Plus className="h-4 w-4" />
          {t("users.createUser")}
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
          <table className="min-w-full">
            <thead className="border-b bg-gray-50">
              <tr>
                <th className="whitespace-nowrap px-6 py-3 text-left text-sm font-medium text-gray-500">
                  {t("users.name")}
                </th>
                <th className="whitespace-nowrap px-6 py-3 text-left text-sm font-medium text-gray-500">
                  {t("users.email")}
                </th>
                <th className="whitespace-nowrap px-6 py-3 text-left text-sm font-medium text-gray-500">
                  {t("users.createdAt")}
                </th>
                <th className="whitespace-nowrap px-6 py-3 text-right text-sm font-medium text-gray-500">
                  {t("users.actions")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {users?.map((user) => (
                <tr key={user.id} className="hover:bg-gray-50">
                  <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-900">
                    {user.name}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-600">
                    {user.email}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-600">
                    {dayjs(user.createdAt)
                      .locale(i18n.language)
                      .format("DD/MM/YYYY HH:mm")}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Tooltip content={t("common.edit")} position="top">
                        <button
                          onClick={() => handleEdit(user)}
                          className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                      </Tooltip>
                      {user.email !== PROTECTED_EMAIL &&
                        (deleteConfirmId === user.id ? (
                          <div className="flex items-center gap-2">
                            <Button
                              size="sm"
                              variant="danger"
                              onClick={() => handleDelete(user.id)}
                              isLoading={deleteUser.isPending}
                            >
                              {t("common.confirm")}
                            </Button>
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => setDeleteConfirmId(null)}
                            >
                              {t("common.cancel")}
                            </Button>
                          </div>
                        ) : (
                          <Tooltip content={t("common.delete")} position="top">
                            <button
                              onClick={() => setDeleteConfirmId(user.id)}
                              className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </Tooltip>
                        ))}
                    </div>
                  </td>
                </tr>
              ))}
              {(!users || users.length === 0) && (
                <tr>
                  <td
                    colSpan={4}
                    className="px-6 py-8 text-center text-gray-500"
                  >
                    {t("users.noUsers")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          </div>
        </CardContent>
      </Card>

      <UserFormModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        user={editingUser}
        onSubmit={handleModalSubmit}
        isLoading={createUser.isPending || updateUser.isPending}
      />
    </div>
  );
}
