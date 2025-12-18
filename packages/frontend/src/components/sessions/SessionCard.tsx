import { Badge, SessionStatusBadge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { formatDuration, formatRelativeDate } from "@/utils/format";
import type { SessionListItem } from "@mrp/shared";
import { Calendar, Clock, Languages } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

interface SessionCardProps {
  session: SessionListItem;
}

export function SessionCard({ session }: SessionCardProps) {
  const { t } = useTranslation();

  return (
    <Link to={`/sessions/${session.id}`}>
      <Card className="transition-shadow hover:shadow-md">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h3 className="font-medium text-gray-900">
                {session.title ?? t("sessions.untitledSession")}
              </h3>
              {session.isSimulated && (
                <Badge className="self-start" variant="secondary">
                  {t("sessions.simulated")}
                </Badge>
              )}
            </div>
            {session.summary && (
              <p className="mt-1 line-clamp-2 text-sm text-gray-500">{session.summary}</p>
            )}
          </div>
          <SessionStatusBadge status={session.status} />
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-4 text-sm text-gray-500">
          <div className="flex items-center gap-1">
            <Calendar className="h-4 w-4" />
            {formatRelativeDate(session.createdAt)}
          </div>
          {session.videoDurationSeconds && (
            <div className="flex items-center gap-1">
              <Clock className="h-4 w-4" />
              {formatDuration(session.videoDurationSeconds)}
            </div>
          )}
          {session.language && (
            <div className="flex items-center gap-1">
              <Languages className="h-4 w-4" />
              {t(`languages.${session.language}`, { defaultValue: session.language.toUpperCase() })}
            </div>
          )}
        </div>

        {session.userTags && session.userTags.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1">
            {session.userTags.slice(0, 5).map((tag) => (
              <Badge key={tag} variant="info">
                {tag}
              </Badge>
            ))}
            {session.userTags.length > 5 && (
              <Badge variant="default">+{session.userTags.length - 5}</Badge>
            )}
          </div>
        )}

        {session.keywords && session.keywords.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {session.keywords.slice(0, 3).map((keyword) => (
              <span key={keyword} className="text-xs text-gray-400">
                #{keyword}
              </span>
            ))}
          </div>
        )}
      </Card>
    </Link>
  );
}
