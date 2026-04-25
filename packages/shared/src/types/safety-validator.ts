/**
 * Step 3 of the patient-sheet pipeline: a separate LLM call (different weights
 * from the generator) that contrasts the generated sheet against the source
 * professional content and produces a five-axis discrepancy report.
 */

export type ValidatorAxisSeverity = "ok" | "minor" | "major" | "critical";

export interface ValidatorAxis {
  severity: ValidatorAxisSeverity;
  notes: string[];
}

export interface ValidatorReport {
  medication: ValidatorAxis;
  diagnostic: ValidatorAxis;
  hallucination: ValidatorAxis;
  warningSign: ValidatorAxis;
  glossary: ValidatorAxis;
}

export type ValidatorStatus = "completed" | "failed";

export interface ValidatorState {
  status: ValidatorStatus | null;
  model: string | null;
  report: ValidatorReport | null;
  runAt: string | null;
}

export interface ConfirmationState {
  confirmedAt: string | null;
  confirmedBy: string | null;
}
