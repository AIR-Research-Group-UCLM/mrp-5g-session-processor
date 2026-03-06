export interface PatientInquiry {
  whatHappened: string;
  diagnosis: string;
  treatmentPlan: string;
  followUp: string;
  warningSigns: string[];
  additionalNotes: string | null;
}

export interface StoredPatientInquiry extends PatientInquiry {
  id: string;
  sessionId: string;
  createdAt: string;
  updatedAt: string;
  shareToken: string | null;
  shareExpiresAt: string | null;
}

export interface PatientInquiryPublic {
  inquiry: PatientInquiry;
  sessionTitle: string | null;
  sessionDate: string;
  expiresAt: string;
}
