import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { SummaryContent } from "@/components/sessions/ConsultationSummaryPanel";
import { useConsultationPatientView } from "@/hooks/useSessions";
import { AlertCircle, ArrowLeft, Calendar, HeartPulse } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";

export function SessionPatientViewPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { data, isLoading, isError } = useConsultationPatientView(id!);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Button variant="secondary" size="sm" onClick={() => navigate(`/sessions/${id}`)}>
          <ArrowLeft className="h-4 w-4" />
          {t("validator.backToReview")}
        </Button>
        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
          {t("validator.patientViewBadge")}
        </span>
      </div>

      {isLoading && (
        <div className="flex items-center gap-3 py-12">
          <Spinner />
          <span className="text-sm text-gray-500">{t("common.loading")}</span>
        </div>
      )}

      {isError && !isLoading && (
        <div className="rounded-xl bg-white p-8 text-center shadow-sm">
          <AlertCircle className="mx-auto h-12 w-12 text-gray-400" />
          <h2 className="mt-4 text-lg font-semibold text-gray-900">
            {t("validator.patientViewUnavailable")}
          </h2>
          <p className="mt-2 text-sm text-gray-500">
            {t("validator.patientViewUnavailableDescription")}
          </p>
        </div>
      )}

      {data && (
        <div className="rounded-xl bg-white p-6 shadow-sm sm:p-8">
          <div className="mb-6 flex items-center gap-2 text-rose-600">
            <HeartPulse className="h-6 w-6" />
            <h1 className="text-xl font-bold">
              {t("consultationSummary.patientPage.title")}
            </h1>
          </div>
          {data.sessionTitle && (
            <h2 className="mb-1 text-lg font-semibold text-gray-900">
              {data.sessionTitle}
            </h2>
          )}
          <div className="mb-6 flex flex-wrap items-center gap-4 text-sm text-gray-500">
            <span className="flex items-center gap-1">
              <Calendar className="h-4 w-4" />
              {new Date(data.sessionDate).toLocaleDateString()}
            </span>
          </div>
          <SummaryContent
            summary={data.summary}
            title={data.sessionTitle}
            date={new Date(data.sessionDate).toLocaleDateString()}
          />
        </div>
      )}
    </div>
  );
}
