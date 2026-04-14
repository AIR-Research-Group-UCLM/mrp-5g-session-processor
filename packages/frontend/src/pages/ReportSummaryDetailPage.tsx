import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Spinner } from "@/components/ui/Spinner";
import { ShareSection } from "@/components/shared/ShareSection";
import { SummaryContent } from "@/components/sessions/ConsultationSummaryPanel";
import {
  useReportSummary,
  useDeleteReportSummary,
  useCreateReportShareToken,
  useRevokeReportShareToken,
} from "@/hooks/useReportSummaries";
import { useAuth } from "@/hooks/useAuth";
import { ArrowLeft, ClipboardList, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";

export function ReportSummaryDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { canWrite } = useAuth();

  const { data: summary, isLoading } = useReportSummary(id!);
  const deleteMutation = useDeleteReportSummary();
  const createShare = useCreateReportShareToken();
  const revokeShare = useRevokeReportShareToken();

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
        {canWrite && summary && (
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
              <SummaryContent
                summary={summary}
                title={summary.title}
                date={new Date(summary.createdAt).toLocaleDateString()}
              />
              <ShareSection
                shareToken={summary.shareToken ?? null}
                shareExpiresAt={summary.shareExpiresAt ?? null}
                onCreateShare={(expiryHours) => createShare.mutate({ summaryId: id!, expiryHours })}
                onRevokeShare={() => revokeShare.mutate(id!)}
                isCreating={createShare.isPending}
                isRevoking={revokeShare.isPending}
              />
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
