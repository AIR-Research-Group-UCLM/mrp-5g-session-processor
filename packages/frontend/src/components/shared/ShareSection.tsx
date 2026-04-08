import { basePathNormalized } from "@/api/client";
import { Button } from "@/components/ui/Button";
import { Check, Copy, Link2, Link2Off } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";

interface ShareSectionProps {
  shareToken: string | null;
  shareExpiresAt: string | null;
  onCreateShare: () => void;
  onRevokeShare: () => void;
  isCreating: boolean;
  isRevoking: boolean;
}

export function ShareSection({
  shareToken,
  shareExpiresAt,
  onCreateShare,
  onRevokeShare,
  isCreating,
  isRevoking,
}: ShareSectionProps) {
  const { t } = useTranslation();
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
              onClick={onRevokeShare}
              isLoading={isRevoking}
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
            onClick={onCreateShare}
            isLoading={isCreating}
          >
            <Link2 className="h-4 w-4" />
            {t("consultationSummary.createShareLink")}
          </Button>
        </div>
      )}
    </div>
  );
}
