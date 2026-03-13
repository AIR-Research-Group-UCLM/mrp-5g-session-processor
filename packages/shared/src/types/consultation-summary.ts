export interface ConsultationSummary {
  whatHappened: string;
  diagnosis: string;
  treatmentPlan: string;
  followUp: string;
  warningSigns: string[];
  additionalNotes: string | null;
}

export interface StoredConsultationSummary extends ConsultationSummary {
  id: string;
  sessionId: string;
  createdAt: string;
  updatedAt: string;
  shareToken: string | null;
  shareExpiresAt: string | null;
}

export interface ConsultationSummaryPublic {
  summary: ConsultationSummary;
  sessionTitle: string | null;
  sessionDate: string;
  expiresAt: string;
}
