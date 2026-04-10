import { getConsultationSummaryByToken } from "@/api/consultation-summary.api";
import { SummaryContent } from "@/components/sessions/ConsultationSummaryPanel";
import { LanguageSelector } from "@/components/ui/LanguageSelector";
import { Spinner } from "@/components/ui/Spinner";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, Calendar, Clock, HeartPulse } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";

export function ConsultationSummaryPage() {
  const { t } = useTranslation();
  const { token } = useParams<{ token: string }>();

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["public-consultation-summary", token],
    queryFn: () => getConsultationSummaryByToken(token!),
    enabled: !!token,
    retry: false,
    staleTime: Infinity,
  });

  const isNotFound =
    isError &&
    error instanceof Error &&
    (error.message.includes("404") || error.message.includes("not found") || error.message.includes("expired"));

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-8">
      <div className="absolute right-4 top-4">
        <LanguageSelector />
      </div>
      <div className="w-full max-w-2xl">
        <div className="mb-6 flex items-center justify-center gap-2 text-rose-600">
          <HeartPulse className="h-8 w-8" />
          <h1 className="text-2xl font-bold">{t("consultationSummary.patientPage.title")}</h1>
        </div>

        {isLoading && (
          <div className="flex flex-col items-center gap-3 py-12">
            <Spinner />
            <span className="text-sm text-gray-500">{t("common.loading")}</span>
          </div>
        )}

        {isError && (
          <div className="rounded-xl bg-white p-8 text-center shadow-sm">
            <AlertCircle className="mx-auto h-12 w-12 text-gray-400" />
            <h2 className="mt-4 text-lg font-semibold text-gray-900">
              {isNotFound
                ? t("consultationSummary.patientPage.expired")
                : t("consultationSummary.patientPage.notFound")}
            </h2>
            <p className="mt-2 text-sm text-gray-500">
              {isNotFound
                ? t("consultationSummary.patientPage.expiredDescription")
                : t("consultationSummary.patientPage.notFoundDescription")}
            </p>
          </div>
        )}

        {data && (
          <div className="rounded-xl bg-white p-6 shadow-sm sm:p-8">
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
              {data.expiresAt && (
                <span className="flex items-center gap-1">
                  <Clock className="h-4 w-4" />
                  {t("consultationSummary.patientPage.expiresOn", {
                    date: new Date(data.expiresAt).toLocaleDateString(),
                  })}
                </span>
              )}
            </div>

            <SummaryContent
              summary={data.summary}
              title={data.sessionTitle}
              date={new Date(data.sessionDate).toLocaleDateString()}
            />

            <div className="mt-6 rounded-lg bg-blue-50 p-4 text-xs text-blue-700">
              {t("consultationSummary.patientPage.disclaimer")}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
