import { Button } from "@/components/ui/Button";
import type {
  ValidatorState,
  ConfirmationState,
  ValidatorAxis,
  ValidatorAxisSeverity,
  ValidatorReport,
} from "@mrp/shared";
import { cn } from "@/utils/cn";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleSlash,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

interface ValidatorPanelProps {
  validator: ValidatorState;
  confirmation: ConfirmationState;
  canWrite: boolean;
  onConfirm: () => void;
  onUnconfirm: () => void;
  isConfirming: boolean;
  isUnconfirming: boolean;
  /** Re-runs only the safety validator against the existing sheet. */
  onRevalidate: () => void;
  isRevalidating: boolean;
  /** Optional: provide a regenerate callback to render the regenerate button (sessions only). */
  onRegenerate?: () => void;
  isRegenerating?: boolean;
}

const SEVERITY_ORDER: ValidatorAxisSeverity[] = ["critical", "major", "minor", "ok"];
const SEVERITY_RANK: Record<ValidatorAxisSeverity, number> = {
  ok: 0,
  minor: 1,
  major: 2,
  critical: 3,
};

const SEVERITY_STYLES: Record<ValidatorAxisSeverity, string> = {
  ok: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  minor: "bg-amber-50 text-amber-700 ring-amber-200",
  major: "bg-orange-50 text-orange-700 ring-orange-200",
  critical: "bg-red-50 text-red-700 ring-red-200",
};

const AXIS_KEYS = [
  "medication",
  "diagnostic",
  "hallucination",
  "warningSign",
  "glossary",
] as const;

type AxisKey = (typeof AXIS_KEYS)[number];

function maxSeverity(report: ValidatorReport): ValidatorAxisSeverity {
  return AXIS_KEYS.reduce<ValidatorAxisSeverity>((acc, key) => {
    const sev = report[key].severity;
    return SEVERITY_RANK[sev] > SEVERITY_RANK[acc] ? sev : acc;
  }, "ok");
}

function SeverityChip({ severity }: { severity: ValidatorAxisSeverity }) {
  const { t } = useTranslation();
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
        SEVERITY_STYLES[severity],
      )}
    >
      {t(`validator.severity.${severity}`)}
    </span>
  );
}

function AxisRow({ axisKey, axis }: { axisKey: AxisKey; axis: ValidatorAxis }) {
  const { t } = useTranslation();
  return (
    <li className="rounded-md border border-gray-200 bg-white p-3">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-gray-700">
          {t(`validator.axis.${axisKey}`)}
        </span>
        <SeverityChip severity={axis.severity} />
      </div>
      {axis.notes.length > 0 ? (
        <ul className="mt-1 list-inside list-disc space-y-0.5 text-xs text-gray-600">
          {axis.notes.map((note, i) => (
            <li key={i}>{note}</li>
          ))}
        </ul>
      ) : (
        <p className="text-xs italic text-gray-400">
          {t("validator.noIssues")}
        </p>
      )}
    </li>
  );
}

export function ValidatorPanel({
  validator,
  confirmation,
  canWrite,
  onConfirm,
  onUnconfirm,
  isConfirming,
  isUnconfirming,
  onRevalidate,
  isRevalidating,
  onRegenerate,
  isRegenerating,
}: ValidatorPanelProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(true);

  const isConfirmed = !!confirmation.confirmedAt;
  const hasReport = validator.status === "completed" && !!validator.report;
  const overall = hasReport ? maxSeverity(validator.report!) : null;

  let HeaderIcon = ShieldQuestion;
  let headerTone = "text-gray-500";
  if (isConfirmed) {
    HeaderIcon = ShieldCheck;
    headerTone = "text-emerald-600";
  } else if (overall === "critical" || overall === "major") {
    HeaderIcon = ShieldAlert;
    headerTone = "text-red-600";
  } else if (overall === "minor") {
    HeaderIcon = AlertTriangle;
    headerTone = "text-amber-600";
  } else if (overall === "ok") {
    HeaderIcon = CheckCircle2;
    headerTone = "text-emerald-600";
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <HeaderIcon className={cn("h-5 w-5", headerTone)} />
          <span className="text-sm font-medium text-gray-700">
            {t("validator.title")}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {isConfirmed ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
              <CheckCircle2 className="h-3 w-3" />
              {t("validator.confirmed")}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
              <AlertTriangle className="h-3 w-3" />
              {t("validator.pending")}
            </span>
          )}
        </div>
      </div>

      {validator.status === null && (
        <p className="mt-3 text-xs text-gray-500">
          {t("validator.notRun")}
        </p>
      )}
      {validator.status === "failed" && (
        <p className="mt-3 flex items-center gap-2 text-xs text-amber-700">
          <CircleSlash className="h-3.5 w-3.5" />
          {t("validator.failed")}
        </p>
      )}

      {hasReport && validator.report && (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {SEVERITY_ORDER.map((sev) => {
              const count = AXIS_KEYS.filter(
                (k) => validator.report![k].severity === sev,
              ).length;
              if (count === 0) return null;
              return (
                <span
                  key={sev}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ring-1 ring-inset",
                    SEVERITY_STYLES[sev],
                  )}
                >
                  {count} × {t(`validator.severity.${sev}`)}
                </span>
              );
            })}
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="ml-auto flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700"
            >
              {expanded ? (
                <>
                  <ChevronUp className="h-3.5 w-3.5" />
                  {t("validator.collapse")}
                </>
              ) : (
                <>
                  <ChevronDown className="h-3.5 w-3.5" />
                  {t("validator.expand")}
                </>
              )}
            </button>
          </div>
          {expanded && (
            <ul className="mt-3 space-y-2">
              {AXIS_KEYS.map((key) => (
                <AxisRow
                  key={key}
                  axisKey={key}
                  axis={validator.report![key]}
                />
              ))}
            </ul>
          )}
        </>
      )}

      {validator.runAt && (
        <p className="mt-2 text-[11px] text-gray-400">
          {t("validator.runAt", {
            date: new Date(validator.runAt).toLocaleString(),
          })}
        </p>
      )}

      {canWrite && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {isConfirmed ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={onUnconfirm}
              isLoading={isUnconfirming}
            >
              {t("validator.unconfirm")}
            </Button>
          ) : (
            <Button
              size="sm"
              variant="primary"
              onClick={onConfirm}
              isLoading={isConfirming}
              disabled={validator.status !== "completed"}
            >
              <CheckCircle2 className="h-4 w-4" />
              {t("validator.confirm")}
            </Button>
          )}
          {validator.status !== "completed" && (
            <Button
              size="sm"
              variant="secondary"
              onClick={onRevalidate}
              isLoading={isRevalidating}
            >
              <RefreshCw className="h-4 w-4" />
              {t("validator.retry")}
            </Button>
          )}
          {onRegenerate && (
            <Button
              size="sm"
              variant="secondary"
              onClick={onRegenerate}
              isLoading={isRegenerating}
            >
              <RefreshCw className="h-4 w-4" />
              {t("consultationSummary.regenerate")}
            </Button>
          )}
        </div>
      )}

      {!isConfirmed && (
        <p className="mt-3 text-xs text-gray-500">{t("validator.gateNotice")}</p>
      )}
    </div>
  );
}
