import { basePathNormalized } from "@/api/client";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Spinner } from "@/components/ui/Spinner";
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
  Copy,
  FileText,
  HeartPulse,
  Link2,
  Link2Off,
  MessageCircle,
  Pill,
  RefreshCw,
  Stethoscope,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";

interface ConsultationSummaryPanelProps {
  sessionId: string;
}

export function SummaryContent({ summary }: { summary: ConsultationSummary }) {
  const { t } = useTranslation();

  return (
    <div className="space-y-5">
      <Section icon={MessageCircle} title={t("consultationSummary.whatHappened")}>
        <p className="text-sm text-gray-700">{summary.whatHappened}</p>
      </Section>

      <Section icon={Stethoscope} title={t("consultationSummary.diagnosis")}>
        <p className="text-sm text-gray-700">{summary.diagnosis}</p>
      </Section>

      <Section icon={Pill} title={t("consultationSummary.treatmentPlan")}>
        <p className="text-sm text-gray-700">{summary.treatmentPlan}</p>
      </Section>

      <Section icon={Calendar} title={t("consultationSummary.followUp")}>
        <p className="text-sm text-gray-700">{summary.followUp}</p>
      </Section>

      {summary.warningSigns.length > 0 && (
        <div className="rounded-lg bg-amber-50 p-3">
          <h4 className="mb-2 flex items-center gap-2 text-sm font-medium text-gray-700">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            {t("consultationSummary.warningSigns")}
          </h4>
          <ul className="list-inside list-disc space-y-1 text-sm text-gray-700">
            {summary.warningSigns.map((sign, i) => (
              <li key={i}>{sign}</li>
            ))}
          </ul>
        </div>
      )}

      {summary.additionalNotes && (
        <Section icon={FileText} title={t("consultationSummary.additionalNotes")}>
          <p className="text-sm text-gray-700">{summary.additionalNotes}</p>
        </Section>
      )}

      <p className="text-xs italic text-gray-400">
        {t("consultationSummary.disclaimer")}
      </p>
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

function ShareSection({ sessionId, shareToken, shareExpiresAt }: {
  sessionId: string;
  shareToken: string | null;
  shareExpiresAt: string | null;
}) {
  const { t } = useTranslation();
  const createShare = useCreateShareToken();
  const revokeShare = useRevokeShareToken();
  const [copied, setCopied] = useState(false);

  const isExpired = shareExpiresAt ? new Date(shareExpiresAt) < new Date() : false;
  const hasActiveLink = shareToken && !isExpired;

  const shareUrl = shareToken
    ? `${window.location.origin}${basePathNormalized}/p/${shareToken}`
    : null;

  const handleCopy = async () => {
    if (!shareUrl) return;
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    toast.success(t("consultationSummary.linkCopied"));
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div>
      {hasActiveLink ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm text-green-700">
            <Link2 className="h-4 w-4" />
            <span>
              {t("consultationSummary.linkActive")} &middot;{" "}
              {t("consultationSummary.linkExpires", {
                date: new Date(shareExpiresAt!).toLocaleDateString(),
              })}
            </span>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={handleCopy}
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {t("consultationSummary.copyLink")}
            </Button>
            <Button
              size="sm"
              variant="danger"
              onClick={() => revokeShare.mutate(sessionId)}
              isLoading={revokeShare.isPending}
            >
              <Link2Off className="h-4 w-4" />
              {t("consultationSummary.revokeLink")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {shareToken && isExpired && (
            <p className="text-sm text-amber-600">{t("consultationSummary.linkExpired")}</p>
          )}
          <Button
            size="sm"
            variant="secondary"
            onClick={() => createShare.mutate(sessionId)}
            isLoading={createShare.isPending}
          >
            <Link2 className="h-4 w-4" />
            {t("consultationSummary.createShareLink")}
          </Button>
        </div>
      )}
    </div>
  );
}

export function ConsultationSummaryPanel({ sessionId }: ConsultationSummaryPanelProps) {
  const { t } = useTranslation();
  const { data: storedSummary, isLoading: isLoadingSummary } = useConsultationSummary(sessionId);
  const mutation = useGenerateConsultationSummary();

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
              sessionId={sessionId}
              shareToken={summary.shareToken ?? null}
              shareExpiresAt={summary.shareExpiresAt ?? null}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
