// Enum types
export type UrgencyLevel = "low" | "medium" | "high";
export type AppointmentPriority = "preferred" | "non_preferred";
export type ProblemStatus = "new" | "chronic" | "exacerbation" | "follow_up" | "resolved";
export type DiagnosticCertainty = "confirmed" | "probable" | "to_be_ruled_out";
export type FollowUpType = "review" | "referral" | "discharge";
export type ResponsibleCareLevel = "primary_care" | "specialist" | "emergency";

// Composite types
export interface DiagnosticHypothesis {
  condition: string;
  certainty: DiagnosticCertainty;
}

export interface TreatmentPlan {
  medicationStarted: string[];
  medicationAdjusted: string[];
  medicationDiscontinued: string[];
  nonPharmacologicalMeasures: string[];
}

export interface FollowUpPlan {
  followUpType: FollowUpType;
  timeFrame: string;
  responsibleCareLevel: ResponsibleCareLevel;
}

// Main interface
export interface ClinicalIndicators {
  id: string;
  sessionId: string;
  urgencyLevel: UrgencyLevel | null;
  appointmentPriority: AppointmentPriority | null;
  reasonForVisit: string | null;
  consultedSpecialty: string | null;
  mainClinicalProblem: string | null;
  problemStatus: ProblemStatus | null;
  diagnosticHypothesis: DiagnosticHypothesis[] | null;
  requestedTests: string[] | null;
  treatmentPlan: TreatmentPlan | null;
  patientEducation: string[] | null;
  warningSigns: string[] | null;
  followUpPlan: FollowUpPlan | null;
  createdAt: string;
  updatedAt: string;
}
