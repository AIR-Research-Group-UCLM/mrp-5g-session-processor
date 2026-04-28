import { basePathNormalized } from "@/api/client";
import { Button } from "@/components/ui/Button";
import { Check, Copy, Link2, Link2Off } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";

const EXPIRY_OPTIONS = [
  { value: 1, labelKey: "consultationSummary.shareExpiry.1h" },
  { value: 24, labelKey: "consultationSummary.shareExpiry.24h" },
  { value: 168, labelKey: "consultationSummary.shareExpiry.7d" },
  { value: 720, labelKey: "consultationSummary.shareExpiry.30d" },
  { value: null, labelKey: "consultationSummary.shareExpiry.never" },
] as const;

interface ShareSectionProps {
  shareToken: string | null;
  shareExpiresAt: string | null;
  onCreateShare: (expiryHours: number | null) => void;
  onRevokeShare: () => void;
  isCreating: boolean;
  isRevoking: boolean;
  /**
   * When true, the create-link control is disabled. Use to gate sharing
   * behind GP confirmation (Step 3 release gate).
   */
  disabled?: boolean;
  /** Human-readable reason shown above the disabled control. */
  disabledReason?: string;
}

export function ShareSection({
  shareToken,
  shareExpiresAt,
  onCreateShare,
  onRevokeShare,
  isCreating,
  isRevoking,
  disabled = false,
  disabledReason,
}: ShareSectionProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [selectedExpiry, setSelectedExpiry] = useState<number | null>(168);

  const isExpired = shareExpiresAt ? new Date(shareExpiresAt) < new Date() : false;
  // A previously-issued token is treated as inactive while sharing is gated
  // (e.g., after regeneration resets GP confirmation): the patient endpoint
  // would refuse it anyway, so the UI mustn't pretend it's live.
  const hasActiveLink = shareToken && !isExpired && !disabled;

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
              {t("consultationSummary.linkActive")}
              {shareExpiresAt ? (
                <>
                  {" "}&middot;{" "}
                  {t("consultationSummary.linkExpires", {
                    date: new Date(shareExpiresAt).toLocaleDateString(),
                  })}
                </>
              ) : (
                <>
                  {" "}&middot; {t("consultationSummary.shareExpiry.noExpiry")}
                </>
              )}
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
          {disabled && disabledReason && (
            <p className="text-sm text-amber-600">{disabledReason}</p>
          )}
          <div className="flex items-center gap-2">
            <select
              value={selectedExpiry === null ? "never" : String(selectedExpiry)}
              onChange={(e) =>
                setSelectedExpiry(e.target.value === "never" ? null : Number(e.target.value))
              }
              disabled={disabled}
              className="rounded-lg border border-gray-300 bg-white px-2 py-1 text-sm text-gray-700 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400"
            >
              {EXPIRY_OPTIONS.map((opt) => (
                <option key={String(opt.value)} value={opt.value === null ? "never" : opt.value}>
                  {t(opt.labelKey)}
                </option>
              ))}
            </select>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => onCreateShare(selectedExpiry)}
              isLoading={isCreating}
              disabled={disabled}
            >
              <Link2 className="h-4 w-4" />
              {t("consultationSummary.createShareLink")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
