import { Badge, SessionStatusBadge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Tooltip } from "@/components/ui/Tooltip";
import { formatDuration, formatProcessingDuration, formatRelativeDate, formatCost } from "@/utils/format";
import type { SessionListItem } from "@mrp/shared";
import { Calendar, Clock, Languages, Timer, Coins } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

interface SessionCardProps {
  session: SessionListItem;
}

export function SessionCard({ session }: SessionCardProps) {
  const { t } = useTranslation();

  // Build time breakdown tooltip
  const buildTimeTooltip = () => {
    const parts: string[] = [];
    if (session.isSimulated && session.simulationDurationMs) {
      parts.push(`${t("timing.simulationSteps")}: ${formatProcessingDuration(session.simulationDurationMs)}`);
    }
    if (session.processingDurationMs) {
      parts.push(`${t("timing.processingSteps")}: ${formatProcessingDuration(session.processingDurationMs)}`);
    }
    return parts.join(" | ");
  };

  // Build cost breakdown tooltip
  const buildCostTooltip = () => {
    const parts: string[] = [];
    if (session.isSimulated && session.simulationCostUsd) {
      parts.push(`${t("costs.simulationCosts")}: ${formatCost(session.simulationCostUsd)}`);
    }
    if (session.processingCostUsd) {
      parts.push(`${t("costs.processingCost")}: ${formatCost(session.processingCostUsd)}`);
    }
    return parts.join(" | ");
  };

  const displayDuration = session.totalDurationMs ?? session.processingDurationMs;
  const displayCost = session.totalCostUsd ?? session.processingCostUsd;

  return (
    <Link to={`/sessions/${session.id}`}>
      <Card className="transition-shadow hover:shadow-md">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <h3 className="font-medium text-gray-900">
              {session.title ?? t("sessions.untitledSession")}
            </h3>
            {session.summary && (
              <p className="mt-1 line-clamp-2 text-sm text-gray-500">{session.summary}</p>
            )}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            {session.status !== "completed" && (
              <SessionStatusBadge status={session.status} />
            )}
            {session.isSimulated && (
              <Badge variant="secondary">
                {t("sessions.simulated")}
              </Badge>
            )}
            {session.isAssigned && !session.isOwner && (
              <Badge variant="info">
                {t("assignments.assignedBadge")}
              </Badge>
            )}
          </div>
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
          {session.status === "completed" && displayDuration && (
            <Tooltip content={buildTimeTooltip()} position="bottom">
              <div className="flex items-center gap-1">
                <Timer className="h-4 w-4" />
                {formatProcessingDuration(displayDuration)}
              </div>
            </Tooltip>
          )}
          {session.status === "completed" && displayCost != null && displayCost > 0 && (
            <Tooltip content={buildCostTooltip()} position="bottom">
              <div className="flex items-center gap-1">
                <Coins className="h-4 w-4" />
                {formatCost(displayCost)}
              </div>
            </Tooltip>
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
