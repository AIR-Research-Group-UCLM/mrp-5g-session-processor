import { basePathNormalized } from "@/api/client";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Spinner } from "@/components/ui/Spinner";
import {
  useCreateShareToken,
  useGeneratePatientInquiry,
  usePatientInquiry,
  useRevokeShareToken,
} from "@/hooks/useSessions";
import type { PatientInquiry } from "@mrp/shared";
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

interface PatientInquiryPanelProps {
  sessionId: string;
}

export function InquiryContent({ inquiry }: { inquiry: PatientInquiry }) {
  const { t } = useTranslation();

  return (
    <div className="space-y-5">
      <Section icon={MessageCircle} title={t("patientInquiry.whatHappened")}>
        <p className="text-sm text-gray-700">{inquiry.whatHappened}</p>
      </Section>

      <Section icon={Stethoscope} title={t("patientInquiry.diagnosis")}>
        <p className="text-sm text-gray-700">{inquiry.diagnosis}</p>
      </Section>

      <Section icon={Pill} title={t("patientInquiry.treatmentPlan")}>
        <p className="text-sm text-gray-700">{inquiry.treatmentPlan}</p>
      </Section>

      <Section icon={Calendar} title={t("patientInquiry.followUp")}>
        <p className="text-sm text-gray-700">{inquiry.followUp}</p>
      </Section>

      {inquiry.warningSigns.length > 0 && (
        <div className="rounded-lg bg-amber-50 p-3">
          <h4 className="mb-2 flex items-center gap-2 text-sm font-medium text-gray-700">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            {t("patientInquiry.warningSigns")}
          </h4>
          <ul className="list-inside list-disc space-y-1 text-sm text-gray-700">
            {inquiry.warningSigns.map((sign, i) => (
              <li key={i}>{sign}</li>
            ))}
          </ul>
        </div>
      )}

      {inquiry.additionalNotes && (
        <Section icon={FileText} title={t("patientInquiry.additionalNotes")}>
          <p className="text-sm text-gray-700">{inquiry.additionalNotes}</p>
        </Section>
      )}

      <p className="text-xs italic text-gray-400">
        {t("patientInquiry.disclaimer")}
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
    toast.success(t("patientInquiry.linkCopied"));
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="border-t pt-4">
      {hasActiveLink ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm text-green-700">
            <Link2 className="h-4 w-4" />
            <span>
              {t("patientInquiry.linkActive")} &middot;{" "}
              {t("patientInquiry.linkExpires", {
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
              {t("patientInquiry.copyLink")}
            </Button>
            <Button
              size="sm"
              variant="danger"
              onClick={() => revokeShare.mutate(sessionId)}
              isLoading={revokeShare.isPending}
            >
              <Link2Off className="h-4 w-4" />
              {t("patientInquiry.revokeLink")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {shareToken && isExpired && (
            <p className="text-sm text-amber-600">{t("patientInquiry.linkExpired")}</p>
          )}
          <Button
            size="sm"
            variant="secondary"
            onClick={() => createShare.mutate(sessionId)}
            isLoading={createShare.isPending}
          >
            <Link2 className="h-4 w-4" />
            {t("patientInquiry.createShareLink")}
          </Button>
        </div>
      )}
    </div>
  );
}

export function PatientInquiryPanel({ sessionId }: PatientInquiryPanelProps) {
  const { t } = useTranslation();
  const { data: storedInquiry, isLoading: isLoadingInquiry } = usePatientInquiry(sessionId);
  const mutation = useGeneratePatientInquiry();

  const inquiry = mutation.data ?? storedInquiry;
  const hasInquiry = !!inquiry;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <HeartPulse className="h-5 w-5 text-rose-600" />
          {t("patientInquiry.title")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoadingInquiry && (
          <div className="flex items-center gap-3 py-6">
            <Spinner />
            <span className="text-sm text-gray-500">{t("common.loading")}</span>
          </div>
        )}

        {!isLoadingInquiry && !hasInquiry && !mutation.isPending && !mutation.isError && (
          <div className="space-y-3">
            <p className="text-sm text-gray-500">
              {t("patientInquiry.description")}
            </p>
            <Button onClick={() => mutation.mutate(sessionId)}>
              {t("patientInquiry.generate")}
            </Button>
          </div>
        )}

        {mutation.isPending && (
          <div className="flex items-center gap-3 py-6">
            <Spinner />
            <span className="text-sm text-gray-500">
              {t("patientInquiry.generating")}
            </span>
          </div>
        )}

        {mutation.isError && !mutation.isPending && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 rounded-lg bg-red-50 p-4 text-sm text-red-700">
              <AlertCircle className="h-4 w-4" />
              {t("patientInquiry.errorGenerating")}
            </div>
            <Button
              variant="secondary"
              onClick={() => mutation.mutate(sessionId)}
            >
              <RefreshCw className="h-4 w-4" />
              {t("patientInquiry.regenerate")}
            </Button>
          </div>
        )}

        {hasInquiry && !mutation.isPending && (
          <div className="space-y-4">
            <InquiryContent inquiry={inquiry} />
            <Button
              variant="secondary"
              onClick={() => mutation.mutate(sessionId)}
            >
              <RefreshCw className="h-4 w-4" />
              {t("patientInquiry.regenerate")}
            </Button>
            <ShareSection
              sessionId={sessionId}
              shareToken={inquiry.shareToken ?? null}
              shareExpiresAt={inquiry.shareExpiresAt ?? null}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
