import type { ConsultationSummary } from "./consultation-summary.js";

export interface StoredReportSummary extends ConsultationSummary {
  id: string;
  userId: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
  shareToken: string | null;
  shareExpiresAt: string | null;
}

export interface ReportSummaryListItem {
  id: string;
  title: string | null;
  createdAt: string;
  shareToken: string | null;
  shareExpiresAt: string | null;
}
