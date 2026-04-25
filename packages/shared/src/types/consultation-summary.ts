import type { ValidatorState, ConfirmationState } from "./safety-validator.js";

export interface ConsultationSummary {
  whatHappened: string;
  diagnosis: string;
  treatmentPlan: string;
  followUp: string;
  warningSigns: string[];
  additionalNotes: string | null;
  tooltips: Record<string, string> | null;
}

export interface StoredConsultationSummary extends ConsultationSummary {
  id: string;
  sessionId: string;
  createdAt: string;
  updatedAt: string;
  shareToken: string | null;
  shareExpiresAt: string | null;
  validator: ValidatorState;
  confirmation: ConfirmationState;
}

export interface ConsultationSummaryPublic {
  summary: ConsultationSummary;
  sessionTitle: string | null;
  sessionDate: string;
  expiresAt: string | null;
}
