import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Search, Check, User, Calendar } from "lucide-react";
import { Input } from "@/components/ui/Input";
import { Spinner } from "@/components/ui/Spinner";
import { useAvailableReportSummaries } from "@/hooks/useAssignments";
import { cn } from "@/utils/cn";
import type {
  ReportSummaryForAssignment,
  ReportSummaryAssignmentInput,
} from "@mrp/shared";
import dayjs from "dayjs";

interface ReportSummaryAssignmentSectionProps {
  userId: string;
  initialAssignments: ReportSummaryAssignmentInput[];
  onAssignmentsChange: (assignments: ReportSummaryAssignmentInput[]) => void;
}

export function ReportSummaryAssignmentSection({
  userId,
  initialAssignments,
  onAssignmentsChange,
}: ReportSummaryAssignmentSectionProps) {
  const { t, i18n } = useTranslation();
  const { data: availableReports, isLoading } =
    useAvailableReportSummaries(userId);
  const [assignments, setAssignments] = useState<Map<string, boolean>>(
    new Map()
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [userHasInteracted, setUserHasInteracted] = useState(false);
  const prevInitialKey = useRef<string>("");

  useEffect(() => {
    const key = JSON.stringify(initialAssignments);
    if (prevInitialKey.current !== key) {
      const map = new Map<string, boolean>();
      for (const a of initialAssignments) {
        map.set(a.reportSummaryId, a.canWrite);
      }
      setAssignments(map);
      setUserHasInteracted(false);
      prevInitialKey.current = key;
    }
  }, [initialAssignments]);

  useEffect(() => {
    if (userHasInteracted) {
      const result: ReportSummaryAssignmentInput[] = [];
      assignments.forEach((canWrite, reportSummaryId) => {
        result.push({ reportSummaryId, canWrite });
      });
      onAssignmentsChange(result);
    }
  }, [assignments, userHasInteracted, onAssignmentsChange]);

  const filteredReports = useMemo(() => {
    if (!availableReports) return [];
    const query = searchQuery.toLowerCase();
    return availableReports.filter(
      (report) =>
        (report.title?.toLowerCase().includes(query) ?? false) ||
        report.ownerName.toLowerCase().includes(query)
    );
  }, [availableReports, searchQuery]);

  const toggleAssignment = useCallback((reportSummaryId: string) => {
    setUserHasInteracted(true);
    setAssignments((prev) => {
      const next = new Map(prev);
      if (next.has(reportSummaryId)) {
        next.delete(reportSummaryId);
      } else {
        next.set(reportSummaryId, false);
      }
      return next;
    });
  }, []);

  const toggleCanWrite = useCallback((reportSummaryId: string) => {
    setUserHasInteracted(true);
    setAssignments((prev) => {
      const next = new Map(prev);
      if (next.has(reportSummaryId)) {
        next.set(reportSummaryId, !next.get(reportSummaryId));
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
          {t("assignments.assignedReportSummaries")}
        </label>
        <p className="mb-3 text-sm text-gray-500">
          {t("assignments.assignedReportSummariesDescription")}
        </p>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <Input
          type="text"
          placeholder={t("assignments.searchReportSummaries")}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-10"
        />
      </div>

      <div className="max-h-64 divide-y overflow-y-auto rounded-lg border">
        {filteredReports.length === 0 ? (
          <div className="p-4 text-center text-gray-500">
            {searchQuery
              ? t("assignments.noReportSummariesFound")
              : t("assignments.noReportSummariesAvailable")}
          </div>
        ) : (
          filteredReports.map((report) => (
            <ReportSummaryAssignmentRow
              key={report.id}
              report={report}
              isSelected={assignments.has(report.id)}
              canWrite={assignments.get(report.id) ?? false}
              onToggle={() => toggleAssignment(report.id)}
              onToggleCanWrite={() => toggleCanWrite(report.id)}
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

interface ReportSummaryAssignmentRowProps {
  report: ReportSummaryForAssignment;
  isSelected: boolean;
  canWrite: boolean;
  onToggle: () => void;
  onToggleCanWrite: () => void;
  locale: string;
}

function ReportSummaryAssignmentRow({
  report,
  isSelected,
  canWrite,
  onToggle,
  onToggleCanWrite,
  locale,
}: ReportSummaryAssignmentRowProps) {
  const { t } = useTranslation();

  return (
    <div
      className={cn(
        "flex items-start gap-3 p-3",
        isSelected ? "bg-blue-50" : "hover:bg-gray-50"
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        className={cn(
          "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border",
          isSelected
            ? "border-blue-600 bg-blue-600"
            : "border-gray-300 hover:border-gray-400"
        )}
      >
        {isSelected && <Check className="h-3 w-3 text-white" />}
      </button>

      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-gray-900">
          {report.title || t("reportSummary.list.untitled")}
        </div>
        <div className="mt-1 flex items-center gap-3 text-xs text-gray-500">
          <span className="flex items-center gap-1">
            <User className="h-3 w-3" />
            {report.ownerName}
          </span>
          <span className="flex items-center gap-1">
            <Calendar className="h-3 w-3" />
            {dayjs(report.createdAt).locale(locale).format("DD/MM/YYYY")}
          </span>
        </div>
      </div>

      {isSelected && (
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onToggleCanWrite}
            className={cn(
              "rounded-full px-3 py-1 text-xs font-medium transition-colors",
              canWrite
                ? "bg-green-100 text-green-700 hover:bg-green-200"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            )}
          >
            {canWrite ? t("assignments.canWrite") : t("assignments.readOnly")}
          </button>
        </div>
      )}
    </div>
  );
}
