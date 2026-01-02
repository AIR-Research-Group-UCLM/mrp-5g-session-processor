import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Search, Check, User, Calendar } from "lucide-react";
import { Input } from "@/components/ui/Input";
import { Spinner } from "@/components/ui/Spinner";
import { useAvailableSessions } from "@/hooks/useAssignments";
import type { SessionForAssignment, AssignmentInput } from "@mrp/shared";
import dayjs from "dayjs";

interface SessionAssignmentSectionProps {
  userId: string;
  initialAssignments: AssignmentInput[];
  onAssignmentsChange: (assignments: AssignmentInput[]) => void;
}

export function SessionAssignmentSection({
  userId,
  initialAssignments,
  onAssignmentsChange,
}: SessionAssignmentSectionProps) {
  const { t, i18n } = useTranslation();
  const { data: availableSessions, isLoading } = useAvailableSessions(userId);
  const [assignments, setAssignments] = useState<Map<string, boolean>>(
    new Map()
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [userHasInteracted, setUserHasInteracted] = useState(false);
  const prevInitialKey = useRef<string>("");

  // Sync state when initialAssignments content changes (modal reopened with fresh data)
  useEffect(() => {
    const key = JSON.stringify(initialAssignments);
    if (prevInitialKey.current !== key) {
      const map = new Map<string, boolean>();
      for (const a of initialAssignments) {
        map.set(a.sessionId, a.canWrite);
      }
      setAssignments(map);
      setUserHasInteracted(false);
      prevInitialKey.current = key;
    }
  }, [initialAssignments]);

  // Notify parent only after user interaction
  useEffect(() => {
    if (userHasInteracted) {
      const result: AssignmentInput[] = [];
      assignments.forEach((canWrite, sessionId) => {
        result.push({ sessionId, canWrite });
      });
      onAssignmentsChange(result);
    }
  }, [assignments, userHasInteracted, onAssignmentsChange]);

  const filteredSessions = useMemo(() => {
    if (!availableSessions) return [];
    const query = searchQuery.toLowerCase();
    return availableSessions.filter(
      (session) =>
        (session.title?.toLowerCase().includes(query) ?? false) ||
        session.ownerName.toLowerCase().includes(query)
    );
  }, [availableSessions, searchQuery]);

  const toggleAssignment = useCallback((sessionId: string) => {
    setUserHasInteracted(true);
    setAssignments((prev) => {
      const next = new Map(prev);
      if (next.has(sessionId)) {
        next.delete(sessionId);
      } else {
        next.set(sessionId, false);
      }
      return next;
    });
  }, []);

  const toggleCanWrite = useCallback((sessionId: string) => {
    setUserHasInteracted(true);
    setAssignments((prev) => {
      const next = new Map(prev);
      if (next.has(sessionId)) {
        next.set(sessionId, !next.get(sessionId));
      }
      return next;
    });
  }, []);

  if (isLoading) {
    return (
      <div className="flex h-32 items-center justify-center">
        <Spinner />
      </div>
    );
  }

  const selectedCount = assignments.size;

  return (
    <div className="space-y-4">
      <div>
        <label className="mb-1.5 block text-sm font-medium text-gray-700">
          {t("assignments.assignedSessions")}
        </label>
        <p className="mb-3 text-sm text-gray-500">
          {t("assignments.assignedSessionsDescription")}
        </p>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <Input
          type="text"
          placeholder={t("assignments.searchSessions")}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-10"
        />
      </div>

      <div className="max-h-64 divide-y overflow-y-auto rounded-lg border">
        {filteredSessions.length === 0 ? (
          <div className="p-4 text-center text-gray-500">
            {searchQuery
              ? t("assignments.noSessionsFound")
              : t("assignments.noSessionsAvailable")}
          </div>
        ) : (
          filteredSessions.map((session) => (
            <SessionAssignmentRow
              key={session.id}
              session={session}
              isSelected={assignments.has(session.id)}
              canWrite={assignments.get(session.id) ?? false}
              onToggle={() => toggleAssignment(session.id)}
              onToggleCanWrite={() => toggleCanWrite(session.id)}
              locale={i18n.language}
            />
          ))
        )}
      </div>

      <div className="text-sm text-gray-500">
        {t("assignments.selectedCount", { count: selectedCount })}
      </div>
    </div>
  );
}

interface SessionAssignmentRowProps {
  session: SessionForAssignment;
  isSelected: boolean;
  canWrite: boolean;
  onToggle: () => void;
  onToggleCanWrite: () => void;
  locale: string;
}

function SessionAssignmentRow({
  session,
  isSelected,
  canWrite,
  onToggle,
  onToggleCanWrite,
  locale,
}: SessionAssignmentRowProps) {
  const { t } = useTranslation();

  return (
    <div
      className={`flex items-start gap-3 p-3 ${isSelected ? "bg-blue-50" : "hover:bg-gray-50"}`}
    >
      {/* Checkbox for assignment */}
      <button
        type="button"
        onClick={onToggle}
        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border ${
          isSelected
            ? "border-blue-600 bg-blue-600"
            : "border-gray-300 hover:border-gray-400"
        }`}
      >
        {isSelected && <Check className="h-3 w-3 text-white" />}
      </button>

      {/* Session info */}
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-gray-900">
          {session.title || t("sessions.untitledSession")}
        </div>
        <div className="mt-1 flex items-center gap-3 text-xs text-gray-500">
          <span className="flex items-center gap-1">
            <User className="h-3 w-3" />
            {session.ownerName}
          </span>
          <span className="flex items-center gap-1">
            <Calendar className="h-3 w-3" />
            {dayjs(session.createdAt).locale(locale).format("DD/MM/YYYY")}
          </span>
          <span
            className={`rounded px-1.5 py-0.5 text-xs ${
              session.status === "completed"
                ? "bg-green-100 text-green-700"
                : session.status === "processing"
                  ? "bg-yellow-100 text-yellow-700"
                  : "bg-gray-100 text-gray-700"
            }`}
          >
            {t(`status.${session.status}`)}
          </span>
        </div>
      </div>

      {/* Permission toggle (only visible when assigned) */}
      {isSelected && (
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onToggleCanWrite}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              canWrite
                ? "bg-green-100 text-green-700 hover:bg-green-200"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            {canWrite ? t("assignments.canWrite") : t("assignments.readOnly")}
          </button>
        </div>
      )}
    </div>
  );
}
