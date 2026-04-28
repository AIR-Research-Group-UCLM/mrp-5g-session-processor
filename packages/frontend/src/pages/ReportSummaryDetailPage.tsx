import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Spinner } from "@/components/ui/Spinner";
import { ShareSection } from "@/components/shared/ShareSection";
import { ValidatorPanel } from "@/components/shared/ValidatorPanel";
import { SummaryContent } from "@/components/sessions/ConsultationSummaryPanel";
import {
  useReportSummary,
  useDeleteReportSummary,
  useCreateReportShareToken,
  useRevokeReportShareToken,
  useConfirmReportSummary,
  useUnconfirmReportSummary,
  useRevalidateReportSummary,
} from "@/hooks/useReportSummaries";
import { AlertTriangle, ArrowLeft, ClipboardList, Eye, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router-dom";

export function ReportSummaryDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { data: summary, isLoading } = useReportSummary(id!);
  const deleteMutation = useDeleteReportSummary();
  const createShare = useCreateReportShareToken();
  const revokeShare = useRevokeReportShareToken();
  const confirmMutation = useConfirmReportSummary();
  const unconfirmMutation = useUnconfirmReportSummary();
  const revalidateMutation = useRevalidateReportSummary();

  // Access signals come from the summary payload itself (owner OR assigned).
  // Delete is owner-only; other writes (share tokens) need canWrite.
  const isOwner = summary?.isOwner ?? false;
  const canWrite = summary?.canWrite ?? false;
  const isConfirmed = !!summary?.confirmation.confirmedAt;
  const validationFailed = summary?.validator.status === "failed";

  const handleDelete = () => {
    if (!id) return;
    if (window.confirm(t("reportSummary.list.deleteConfirm"))) {
      deleteMutation.mutate(id, {
        onSuccess: () => navigate("/report-summary"),
      });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => navigate("/report-summary")}
          >
            <ArrowLeft className="h-4 w-4" />
            {t("common.back")}
          </Button>
          <h1 className="text-2xl font-bold text-gray-900">
            {summary?.title || t("reportSummary.list.untitled")}
          </h1>
        </div>
        {isOwner && summary && (
          <Button
            variant="danger"
            size="sm"
            onClick={handleDelete}
            isLoading={deleteMutation.isPending}
          >
            <Trash2 className="h-4 w-4" />
            {t("common.delete")}
          </Button>
        )}
      </div>

      {isLoading && (
        <div className="flex items-center gap-3 py-12">
          <Spinner />
          <span className="text-sm text-gray-500">{t("common.loading")}</span>
        </div>
      )}

      {!isLoading && !summary && (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-sm text-gray-500">
              {t("reportSummary.list.empty")}
            </p>
          </CardContent>
        </Card>
      )}

      {summary && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ClipboardList className="h-5 w-5 text-indigo-600" />
              {t("consultationSummary.title")}
            </CardTitle>
            <p className="text-sm text-gray-500">
              {new Date(summary.createdAt).toLocaleDateString()}
            </p>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {validationFailed ? (
                <div className="rounded-lg border border-amber-300 bg-amber-50 p-4">
                  <div className="flex items-start gap-2 text-sm text-amber-800">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <div>
                      <p className="font-medium">{t("validator.sheetHidden")}</p>
                      <p className="mt-1 text-amber-700">
                        {t("validator.sheetHiddenDescription")}
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                <SummaryContent
                  summary={summary}
                  title={summary.title}
                  date={new Date(summary.createdAt).toLocaleDateString()}
                />
              )}
              <ValidatorPanel
                validator={summary.validator}
                confirmation={summary.confirmation}
                canWrite={canWrite}
                onConfirm={() => confirmMutation.mutate(id!)}
                onUnconfirm={() => unconfirmMutation.mutate(id!)}
                isConfirming={confirmMutation.isPending}
                isUnconfirming={unconfirmMutation.isPending}
                onRevalidate={() => revalidateMutation.mutate(id!)}
                isRevalidating={revalidateMutation.isPending}
              />
              {canWrite && (
                <ShareSection
                  shareToken={summary.shareToken ?? null}
                  shareExpiresAt={summary.shareExpiresAt ?? null}
                  onCreateShare={(expiryHours) => createShare.mutate({ summaryId: id!, expiryHours })}
                  onRevokeShare={() => revokeShare.mutate(id!)}
                  isCreating={createShare.isPending}
                  isRevoking={revokeShare.isPending}
                  disabled={!isConfirmed}
                  disabledReason={!isConfirmed ? t("validator.shareGated") : undefined}
                />
              )}
              {isConfirmed && (
                <Link
                  to={`/report-summaries/${id}/patient-view`}
                  className="inline-flex items-center gap-2 text-sm text-primary-600 hover:text-primary-700"
                >
                  <Eye className="h-4 w-4" />
                  {t("validator.openPatientView")}
                </Link>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
