import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Spinner } from "@/components/ui/Spinner";
import { Badge } from "@/components/ui/Badge";
import { FileTextDropzone } from "@/components/shared/FileTextDropzone";
import { ShareSection } from "@/components/shared/ShareSection";
import { SummaryContent } from "@/components/sessions/ConsultationSummaryPanel";
import {
  useGenerateReportSummary,
  useReportSummaries,
  useDeleteReportSummary,
  useCreateReportShareToken,
  useRevokeReportShareToken,
} from "@/hooks/useReportSummaries";
import { useAuth } from "@/hooks/useAuth";
import type { StoredReportSummary } from "@mrp/shared";
import {
  AlertCircle,
  ClipboardList,
  FileText,
  Link2,
  PlusCircle,
  Send,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

export function ReportSummaryPage() {
  const { t } = useTranslation();
  const { canWrite } = useAuth();
  const [reportText, setReportText] = useState("");
  const [title, setTitle] = useState("");
  const [generatedSummary, setGeneratedSummary] = useState<StoredReportSummary | null>(null);

  const generateMutation = useGenerateReportSummary();
  const createShare = useCreateReportShareToken();
  const revokeShare = useRevokeReportShareToken();

  const [listPage, setListPage] = useState(1);
  const { data: listData, isLoading: isLoadingList } = useReportSummaries({
    page: listPage,
    pageSize: 10,
  });

  const totalPages = listData ? Math.ceil(listData.total / listData.pageSize) : 0;

  const handleGenerate = () => {
    generateMutation.mutate(
      { reportText, title: title.trim() || undefined },
      {
        onSuccess: (data) => {
          setGeneratedSummary(data);
          setReportText("");
          setTitle("");
        },
      },
    );
  };

  const handleGenerateAnother = () => {
    setGeneratedSummary(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">
          {t("reportSummary.title")}
        </h1>
      </div>

      {/* Generation Form / Result */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5 text-indigo-600" />
            {generatedSummary
              ? t("consultationSummary.title")
              : t("reportSummary.title")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!generatedSummary && !generateMutation.isPending && (
            <div className="space-y-4">
              <p className="text-sm text-gray-500">
                {t("reportSummary.description")}
              </p>

              <Input
                id="report-title"
                label={t("reportSummary.titleLabel")}
                placeholder={t("reportSummary.titlePlaceholder")}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />

              <FileTextDropzone
                onTextExtracted={setReportText}
                disabled={generateMutation.isPending}
              />

              <div>
                <label
                  htmlFor="report-text"
                  className="mb-1.5 block text-sm font-medium text-gray-700"
                >
                  {t("reportSummary.reportLabel")}
                </label>
                <textarea
                  id="report-text"
                  className="input min-h-[200px] resize-y"
                  placeholder={t("reportSummary.reportPlaceholder")}
                  value={reportText}
                  onChange={(e) => setReportText(e.target.value)}
                />
                <div className="mt-1 flex items-center justify-between">
                  <p className="text-xs text-gray-400">
                    {t("reportSummary.charCount", { count: reportText.length })}
                  </p>
                  {reportText.length > 0 && reportText.length < 50 && (
                    <p className="text-xs text-amber-600">
                      {t("reportSummary.minChars")}
                    </p>
                  )}
                </div>
              </div>

              {canWrite && (
                <Button
                  onClick={handleGenerate}
                  disabled={reportText.length < 50}
                >
                  <Send className="h-4 w-4" />
                  {t("reportSummary.generate")}
                </Button>
              )}
            </div>
          )}

          {generateMutation.isPending && (
            <div className="flex items-center gap-3 py-6">
              <Spinner />
              <span className="text-sm text-gray-500">
                {t("reportSummary.generating")}
              </span>
            </div>
          )}

          {generateMutation.isError && !generateMutation.isPending && !generatedSummary && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 rounded-lg bg-red-50 p-4 text-sm text-red-700">
                <AlertCircle className="h-4 w-4" />
                {t("reportSummary.errorGenerating")}
              </div>
              <Button variant="secondary" onClick={handleGenerateAnother}>
                <PlusCircle className="h-4 w-4" />
                {t("reportSummary.generateNew")}
              </Button>
            </div>
          )}

          {generatedSummary && (
            <div className="space-y-4">
              <SummaryContent
                summary={generatedSummary}
                title={generatedSummary.title}
                date={new Date(generatedSummary.createdAt).toLocaleDateString()}
              />
              <ShareSection
                shareToken={generatedSummary.shareToken ?? null}
                shareExpiresAt={generatedSummary.shareExpiresAt ?? null}
                onCreateShare={(expiryHours) => createShare.mutate({ summaryId: generatedSummary.id, expiryHours }, {
                  onSuccess: (data) => {
                    setGeneratedSummary({
                      ...generatedSummary,
                      shareToken: data.token,
                      shareExpiresAt: data.expiresAt,
                    });
                  },
                })}
                onRevokeShare={() => revokeShare.mutate(generatedSummary.id, {
                  onSuccess: () => {
                    setGeneratedSummary({
                      ...generatedSummary,
                      shareToken: null,
                      shareExpiresAt: null,
                    });
                  },
                })}
                isCreating={createShare.isPending}
                isRevoking={revokeShare.isPending}
              />
              <Button variant="secondary" onClick={handleGenerateAnother}>
                <PlusCircle className="h-4 w-4" />
                {t("reportSummary.generateNew")}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* History List */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-gray-600" />
            {t("reportSummary.list.title")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoadingList && (
            <div className="flex items-center gap-3 py-6">
              <Spinner />
              <span className="text-sm text-gray-500">{t("common.loading")}</span>
            </div>
          )}

          {!isLoadingList && (!listData || listData.summaries.length === 0) && (
            <div className="py-6 text-center">
              <ClipboardList className="mx-auto h-8 w-8 text-gray-300" />
              <p className="mt-2 text-sm text-gray-500">
                {t("reportSummary.list.empty")}
              </p>
              <p className="text-xs text-gray-400">
                {t("reportSummary.list.emptyDescription")}
              </p>
            </div>
          )}

          {listData && listData.summaries.length > 0 && (
            <div className="space-y-2">
              {listData.summaries.map((item) => (
                <ReportSummaryListRow key={item.id} item={item} />
              ))}
            </div>
          )}

          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={listPage === 1}
                onClick={() => setListPage((p) => p - 1)}
              >
                {t("common.previous")}
              </Button>
              <span className="text-sm text-gray-600">
                {t("common.page", { current: listPage, total: totalPages })}
              </span>
              <Button
                variant="secondary"
                size="sm"
                disabled={listPage === totalPages}
                onClick={() => setListPage((p) => p + 1)}
              >
                {t("common.next")}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ReportSummaryListRow({
  item,
}: {
  item: { id: string; title: string | null; createdAt: string; shareToken: string | null; shareExpiresAt: string | null };
}) {
  const { t } = useTranslation();
  const { canWrite } = useAuth();
  const deleteMutation = useDeleteReportSummary();

  const isShared =
    item.shareToken &&
    (!item.shareExpiresAt || new Date(item.shareExpiresAt) > new Date());

  return (
    <div className="flex items-center justify-between rounded-lg border border-gray-200 px-4 py-3">
      <Link
        to={`/report-summaries/${item.id}`}
        className="flex min-w-0 flex-1 items-center gap-3 hover:text-primary-600"
      >
        <FileText className="h-4 w-4 shrink-0 text-gray-400" />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-gray-900">
            {item.title || t("reportSummary.list.untitled")}
          </p>
          <p className="text-xs text-gray-500">
            {new Date(item.createdAt).toLocaleDateString()}
          </p>
        </div>
      </Link>
      <div className="flex items-center gap-2">
        {isShared && (
          <Badge variant="success">
            <Link2 className="mr-1 h-3 w-3" />
            {t("consultationSummary.linkActive")}
          </Badge>
        )}
        {canWrite && (
          <Button
            variant="danger"
            size="sm"
            onClick={() => {
              if (window.confirm(t("reportSummary.list.deleteConfirm"))) {
                deleteMutation.mutate(item.id);
              }
            }}
            isLoading={deleteMutation.isPending}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
