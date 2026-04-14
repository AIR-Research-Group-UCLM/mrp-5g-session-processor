import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Spinner } from "@/components/ui/Spinner";
import { Tooltip } from "@/components/ui/Tooltip";
import { ShareSection } from "@/components/shared/ShareSection";
import {
  useCreateShareToken,
  useGenerateConsultationSummary,
  useConsultationSummary,
  useRevokeShareToken,
} from "@/hooks/useSessions";
import type { ConsultationSummary } from "@mrp/shared";
import {
  AlertCircle,
  AlertTriangle,
  Calendar,
  Check,
  ClipboardCopy,
  FileText,
  HeartPulse,
  MessageCircle,
  Pill,
  RefreshCw,
  Stethoscope,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";

interface SummaryContentProps {
  summary: ConsultationSummary;
  title?: string | null;
  date?: string | null;
}

function TextWithTooltips({
  text,
  tooltips,
}: {
  text: string;
  tooltips: Record<string, string> | null;
}): ReactNode {
  if (!tooltips || Object.keys(tooltips).length === 0) {
    return text;
  }

  // Build a regex matching all tooltip terms (longest first to avoid partial matches)
  const terms = Object.keys(tooltips).sort((a, b) => b.length - a.length);
  const escaped = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const regex = new RegExp(`\\b(${escaped.join("|")})\\b`, "gi");

  const parts = text.split(regex);
  const seen = new Set<string>();

  return parts.map((part, i) => {
    const key = Object.keys(tooltips).find(
      (k) => k.toLowerCase() === part.toLowerCase(),
    );
    // Only wrap the first occurrence of each term
    if (key && !seen.has(key.toLowerCase())) {
      seen.add(key.toLowerCase());
      return (
        <Tooltip key={i} content={tooltips[key]!}>
          <span className="cursor-help border-b border-dashed border-gray-400">
            {part}
          </span>
        </Tooltip>
      );
    }
    return part;
  });
}

function buildMarkdown(
  summary: ConsultationSummary,
  t: (key: string) => string,
  title?: string | null,
  date?: string | null,
): string {
  const lines: string[] = [];

  if (title) lines.push(`# ${title}`);
  if (date) lines.push(date);
  if (title || date) lines.push("");

  lines.push(`## ${t("consultationSummary.whatHappened")}`, summary.whatHappened, "");
  lines.push(`## ${t("consultationSummary.diagnosis")}`, summary.diagnosis, "");
  lines.push(`## ${t("consultationSummary.treatmentPlan")}`, summary.treatmentPlan, "");
  lines.push(`## ${t("consultationSummary.followUp")}`, summary.followUp, "");

  if (summary.warningSigns.length > 0) {
    lines.push(`## ${t("consultationSummary.warningSigns")}`);
    for (const sign of summary.warningSigns) {
      lines.push(`- ${sign}`);
    }
    lines.push("");
  }

  if (summary.additionalNotes) {
    lines.push(`## ${t("consultationSummary.additionalNotes")}`, summary.additionalNotes, "");
  }

  lines.push("---", `*${t("consultationSummary.disclaimer")}*`);

  return lines.join("\n");
}

export function SummaryContent({ summary, title, date }: SummaryContentProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const handleCopyMarkdown = async () => {
    const md = buildMarkdown(summary, t, title, date);
    await navigator.clipboard.writeText(md);
    setCopied(true);
    toast.success(t("consultationSummary.markdownCopied"));
    setTimeout(() => setCopied(false), 2000);
  };

  const tooltips = summary.tooltips;

  return (
    <div className="space-y-5">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleCopyMarkdown}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
          title={t("consultationSummary.copyMarkdown")}
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <ClipboardCopy className="h-3.5 w-3.5" />}
          {t("consultationSummary.copyMarkdown")}
        </button>
      </div>

      <Section icon={MessageCircle} title={t("consultationSummary.whatHappened")}>
        <p className="whitespace-pre-line text-sm text-gray-700">
          <TextWithTooltips text={summary.whatHappened} tooltips={tooltips} />
        </p>
      </Section>

      <Section icon={Stethoscope} title={t("consultationSummary.diagnosis")}>
        <p className="whitespace-pre-line text-sm text-gray-700">
          <TextWithTooltips text={summary.diagnosis} tooltips={tooltips} />
        </p>
      </Section>

      <Section icon={Pill} title={t("consultationSummary.treatmentPlan")}>
        <p className="whitespace-pre-line text-sm text-gray-700">
          <TextWithTooltips text={summary.treatmentPlan} tooltips={tooltips} />
        </p>
      </Section>

      <Section icon={Calendar} title={t("consultationSummary.followUp")}>
        <p className="whitespace-pre-line text-sm text-gray-700">
          <TextWithTooltips text={summary.followUp} tooltips={tooltips} />
        </p>
      </Section>

      {summary.warningSigns.length > 0 && (
        <div className="rounded-lg bg-amber-50 p-3">
          <h4 className="mb-2 flex items-center gap-2 text-sm font-medium text-gray-700">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            {t("consultationSummary.warningSigns")}
          </h4>
          <ul className="list-inside list-disc space-y-1 text-sm text-gray-700">
            {summary.warningSigns.map((sign, i) => (
              <li key={i}>
                <TextWithTooltips text={sign} tooltips={tooltips} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {summary.additionalNotes?.trim() && (
        <Section icon={FileText} title={t("consultationSummary.additionalNotes")}>
          <p className="whitespace-pre-line text-sm text-gray-700">
            <TextWithTooltips text={summary.additionalNotes} tooltips={tooltips} />
          </p>
        </Section>
      )}

      <div className="rounded-lg bg-blue-50 p-4 text-xs text-blue-700">
        {t("consultationSummary.disclaimer")}
      </div>
    </div>
  );
}

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h4 className="mb-2 flex items-center gap-2 text-sm font-medium text-gray-700">
        <Icon className="h-4 w-4 text-gray-500" />
        {title}
      </h4>
      {children}
    </div>
  );
}

interface ConsultationSummaryPanelProps {
  sessionId: string;
}

export function ConsultationSummaryPanel({ sessionId }: ConsultationSummaryPanelProps) {
  const { t } = useTranslation();
  const { data: storedSummary, isLoading: isLoadingSummary } = useConsultationSummary(sessionId);
  const mutation = useGenerateConsultationSummary();
  const createShare = useCreateShareToken();
  const revokeShare = useRevokeShareToken();

  const summary = storedSummary;
  const hasSummary = !!summary;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <HeartPulse className="h-5 w-5 text-rose-600" />
          {t("consultationSummary.title")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoadingSummary && (
          <div className="flex items-center gap-3 py-6">
            <Spinner />
            <span className="text-sm text-gray-500">{t("common.loading")}</span>
          </div>
        )}

        {!isLoadingSummary && !hasSummary && !mutation.isPending && !mutation.isError && (
          <div className="space-y-3">
            <p className="text-sm text-gray-500">
              {t("consultationSummary.notGenerated")}
            </p>
            <Button
              variant="secondary"
              onClick={() => mutation.mutate(sessionId)}
            >
              <RefreshCw className="h-4 w-4" />
              {t("consultationSummary.regenerate")}
            </Button>
          </div>
        )}

        {mutation.isPending && (
          <div className="flex items-center gap-3 py-6">
            <Spinner />
            <span className="text-sm text-gray-500">
              {t("consultationSummary.generating")}
            </span>
          </div>
        )}

        {mutation.isError && !mutation.isPending && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 rounded-lg bg-red-50 p-4 text-sm text-red-700">
              <AlertCircle className="h-4 w-4" />
              {t("consultationSummary.errorGenerating")}
            </div>
            <Button
              variant="secondary"
              onClick={() => mutation.mutate(sessionId)}
            >
              <RefreshCw className="h-4 w-4" />
              {t("consultationSummary.regenerate")}
            </Button>
          </div>
        )}

        {hasSummary && !mutation.isPending && (
          <div className="space-y-4">
            <SummaryContent summary={summary} />
            <ShareSection
              shareToken={summary.shareToken ?? null}
              shareExpiresAt={summary.shareExpiresAt ?? null}
              onCreateShare={(expiryHours) => createShare.mutate({ sessionId, expiryHours })}
              onRevokeShare={() => revokeShare.mutate(sessionId)}
              isCreating={createShare.isPending}
              isRevoking={revokeShare.isPending}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
