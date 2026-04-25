import type { ConsultationSummary } from "./consultation-summary.js";
import type { ValidatorState, ConfirmationState } from "./safety-validator.js";

export interface StoredReportSummary extends ConsultationSummary {
  id: string;
  userId: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
  shareToken: string | null;
  shareExpiresAt: string | null;
  isOwner: boolean;
  canWrite: boolean;
  validator: ValidatorState;
  confirmation: ConfirmationState;
}

export interface ReportSummaryListItem {
  id: string;
  title: string | null;
  createdAt: string;
  shareToken: string | null;
  shareExpiresAt: string | null;
  isOwner: boolean;
  canWrite: boolean;
}
