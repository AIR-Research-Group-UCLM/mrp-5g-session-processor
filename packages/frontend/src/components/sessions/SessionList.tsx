import { useTranslation } from "react-i18next";
import type { SessionListItem } from "@mrp/shared";
import { SessionCard } from "./SessionCard";
import { Spinner } from "@/components/ui/Spinner";
import { FolderOpen } from "lucide-react";

interface SessionListProps {
  sessions: SessionListItem[];
  isLoading: boolean;
}

export function SessionList({ sessions, isLoading }: SessionListProps) {
  const { t } = useTranslation();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Spinner />
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-gray-500">
        <FolderOpen className="mb-4 h-12 w-12" />
        <p>{t("sessions.noSessions")}</p>
      </div>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {sessions.map((session) => (
        <SessionCard key={session.id} session={session} />
      ))}
    </div>
  );
}
