import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { SessionAssignmentSection } from "./SessionAssignmentSection";
import { ReportSummaryAssignmentSection } from "./ReportSummaryAssignmentSection";
import {
  useUserAssignments,
  useSetUserAssignments,
  useUserReportSummaryAssignments,
  useSetUserReportSummaryAssignments,
} from "@/hooks/useAssignments";
import type {
  UserListItem,
  CreateUserInput,
  UpdateUserInput,
  UserRole,
  AssignmentInput,
  ReportSummaryAssignmentInput,
} from "@mrp/shared";

const PROTECTED_EMAIL = "admin@user.com";

function assignmentsChanged<T>(
  current: T[] | undefined,
  pending: T[],
  key: (item: T) => string
): boolean {
  const currentKeys = new Set(current?.map(key) ?? []);
  const pendingKeys = new Set(pending.map(key));
  if (currentKeys.size !== pendingKeys.size) return true;
  for (const k of currentKeys) {
    if (!pendingKeys.has(k)) return true;
  }
  return false;
}

interface UserFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  user?: UserListItem | null;
  onSubmit: (data: CreateUserInput | UpdateUserInput) => Promise<void>;
  isLoading: boolean;
}

export function UserFormModal({
  isOpen,
  onClose,
  user,
  onSubmit,
  isLoading,
}: UserFormModalProps) {
  const { t } = useTranslation();
  const isEditMode = !!user;
  const isProtectedUser = user?.email === PROTECTED_EMAIL;

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<UserRole>("user");
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [pendingAssignments, setPendingAssignments] = useState<AssignmentInput[]>([]);
  const { data: currentAssignments } = useUserAssignments(isEditMode && isOpen ? user?.id ?? null : null);
  const setUserAssignments = useSetUserAssignments();

  const [pendingReportAssignments, setPendingReportAssignments] = useState<
    ReportSummaryAssignmentInput[]
  >([]);
  const { data: currentReportAssignments } = useUserReportSummaryAssignments(
    isEditMode && isOpen ? user?.id ?? null : null
  );
  const setUserReportAssignments = useSetUserReportSummaryAssignments();

  // Track whether pending state has been seeded for this modal-open session.
  // Prevents React Query refetches (e.g., on window focus) from clobbering edits.
  const sessionsSeededRef = useRef(false);
  const reportsSeededRef = useRef(false);

  useEffect(() => {
    if (isOpen) {
      setName(user?.name ?? "");
      setEmail(user?.email ?? "");
      setPassword("");
      setRole(user?.role ?? "user");
      setErrors({});
      setPendingAssignments([]);
      setPendingReportAssignments([]);
      sessionsSeededRef.current = false;
      reportsSeededRef.current = false;
    }
  }, [isOpen, user]);

  useEffect(() => {
    if (isOpen && !sessionsSeededRef.current && currentAssignments) {
      setPendingAssignments(
        currentAssignments.map((a) => ({
          sessionId: a.sessionId,
          canWrite: a.canWrite,
        }))
      );
      sessionsSeededRef.current = true;
    }
  }, [isOpen, currentAssignments]);

  useEffect(() => {
    if (isOpen && !reportsSeededRef.current && currentReportAssignments) {
      setPendingReportAssignments(
        currentReportAssignments.map((a) => ({
          reportSummaryId: a.reportSummaryId,
          canWrite: a.canWrite,
        }))
      );
      reportsSeededRef.current = true;
    }
  }, [isOpen, currentReportAssignments]);

  const handleAssignmentsChange = useCallback((assignments: AssignmentInput[]) => {
    setPendingAssignments(assignments);
  }, []);

  const handleReportAssignmentsChange = useCallback(
    (assignments: ReportSummaryAssignmentInput[]) => {
      setPendingReportAssignments(assignments);
    },
    []
  );

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!name.trim()) {
      newErrors.name = t("users.nameRequired");
    }

    if (!email.trim()) {
      newErrors.email = t("users.emailRequired");
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      newErrors.email = t("users.emailInvalid");
    }

    if (!isEditMode) {
      if (!password || password.length < 8) {
        newErrors.password = t("users.passwordMinLength");
      }
    } else if (password && password.length < 8) {
      newErrors.password = t("users.passwordMinLength");
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    if (isEditMode) {
      const data: UpdateUserInput = {};
      if (name !== user?.name) data.name = name;
      if (email !== user?.email) data.email = email;
      if (password) data.password = password;
      if (role !== user?.role && !isProtectedUser) data.role = role;
      await onSubmit(data);

      if (user) {
        const sessionsChanged = assignmentsChanged(
          currentAssignments,
          pendingAssignments,
          (a) => `${a.sessionId}:${a.canWrite}`
        );
        if (sessionsChanged) {
          await setUserAssignments.mutateAsync({
            userId: user.id,
            assignments: pendingAssignments,
          });
        }

        const reportsChanged = assignmentsChanged(
          currentReportAssignments,
          pendingReportAssignments,
          (a) => `${a.reportSummaryId}:${a.canWrite}`
        );
        if (reportsChanged) {
          await setUserReportAssignments.mutateAsync({
            userId: user.id,
            assignments: pendingReportAssignments,
          });
        }
      }
    } else {
      await onSubmit({ name, email, password, role });
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isEditMode ? t("users.editUser") : t("users.createUser")}
      className={isEditMode ? "max-w-4xl" : "max-w-md"}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          id="name"
          label={t("users.name")}
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={errors.name}
          disabled={isLoading}
          required
        />

        <Input
          id="email"
          label={t("users.email")}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={errors.email}
          disabled={isLoading}
          required
        />

        <Input
          id="password"
          label={isEditMode ? t("users.newPassword") : t("users.password")}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={errors.password}
          disabled={isLoading}
          placeholder={isEditMode ? t("users.leaveBlankToKeep") : undefined}
          required={!isEditMode}
        />

        <div>
          <label
            htmlFor="role"
            className="mb-1.5 block text-sm font-medium text-gray-700"
          >
            {t("users.role")}
          </label>
          <select
            id="role"
            value={role}
            onChange={(e) => setRole(e.target.value as UserRole)}
            disabled={isLoading || isProtectedUser}
            className="input"
          >
            <option value="user">{t("roles.user")}</option>
            <option value="admin">{t("roles.admin")}</option>
            <option value="readonly">{t("roles.readonly")}</option>
          </select>
          {isProtectedUser && (
            <p className="mt-1 text-xs text-gray-500">
              {t("users.protectedUserRole")}
            </p>
          )}
        </div>

        {isEditMode && user && (
          <div className="mt-4 grid gap-6 border-t pt-4 md:grid-cols-2">
            <SessionAssignmentSection
              userId={user.id}
              initialAssignments={
                currentAssignments?.map((a) => ({
                  sessionId: a.sessionId,
                  canWrite: a.canWrite,
                })) ?? []
              }
              onAssignmentsChange={handleAssignmentsChange}
            />
            <ReportSummaryAssignmentSection
              userId={user.id}
              initialAssignments={
                currentReportAssignments?.map((a) => ({
                  reportSummaryId: a.reportSummaryId,
                  canWrite: a.canWrite,
                })) ?? []
              }
              onAssignmentsChange={handleReportAssignmentsChange}
            />
          </div>
        )}

        <div className="flex justify-end gap-3 pt-4">
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            disabled={
              isLoading ||
              setUserAssignments.isPending ||
              setUserReportAssignments.isPending
            }
          >
            {t("common.cancel")}
          </Button>
          <Button
            type="submit"
            isLoading={
              isLoading ||
              setUserAssignments.isPending ||
              setUserReportAssignments.isPending
            }
          >
            {isEditMode ? t("common.save") : t("users.create")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
