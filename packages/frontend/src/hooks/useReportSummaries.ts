import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import * as reportSummaryApi from "@/api/report-summary.api";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";

export function useReportSummaries(params?: {
  page?: number;
  pageSize?: number;
}) {
  return useQuery({
    queryKey: ["report-summaries", params],
    queryFn: () => reportSummaryApi.listReportSummaries(params),
  });
}

export function useReportSummary(id: string) {
  return useQuery({
    queryKey: ["report-summary", id],
    queryFn: () => reportSummaryApi.getReportSummary(id),
    enabled: !!id,
  });
}

export function useGenerateReportSummary() {
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: ({ reportText, title }: { reportText: string; title?: string }) =>
      reportSummaryApi.generateReportSummary(reportText, title),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["report-summaries"] });
    },
    onError: (error: Error) => {
      toast.error(error.message || t("reportSummary.errorGenerating"));
    },
  });
}

export function useDeleteReportSummary() {
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: (id: string) => reportSummaryApi.deleteReportSummary(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["report-summaries"] });
      toast.success(t("reportSummary.list.deleteSuccess"));
    },
    onError: (error: Error) => {
      toast.error(error.message || t("reportSummary.list.deleteError"));
    },
  });
}

export function useCreateReportShareToken() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (summaryId: string) => reportSummaryApi.createReportShareToken(summaryId),
    onSuccess: (_, summaryId) => {
      queryClient.invalidateQueries({ queryKey: ["report-summary", summaryId] });
      queryClient.invalidateQueries({ queryKey: ["report-summaries"] });
    },
    onError: (error: Error) => {
      toast.error(error.message || "Error creating share link");
    },
  });
}

export function useRevokeReportShareToken() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (summaryId: string) => reportSummaryApi.revokeReportShareToken(summaryId),
    onSuccess: (_, summaryId) => {
      queryClient.invalidateQueries({ queryKey: ["report-summary", summaryId] });
      queryClient.invalidateQueries({ queryKey: ["report-summaries"] });
    },
    onError: (error: Error) => {
      toast.error(error.message || "Error revoking share link");
    },
  });
}
