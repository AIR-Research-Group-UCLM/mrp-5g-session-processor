import { z } from "zod";
import type {
  ConsultationSummary,
  ValidatorReport,
  ValidatorAxis,
} from "@mrp/shared";
import { config } from "../config/index.js";
import { logger } from "../config/logger.js";
import { withRetry } from "../utils/retry.js";
import { callOpenWebUi, extractJson } from "../utils/llm.js";

// LLM contract: a flat object of axis → array of issue strings.
// Empty array (or missing key) means "no issue on this axis". The severity
// classification is synthesized in code (empty → ok, non-empty → major).
// Keeping the model's output shape this simple matters for smaller open-weight
// models that struggle with nested JSON schemas.
// Extract a string from an object-shaped issue if the model wraps each item
// in `{issue: "..."}` / `{text: "..."}` / etc. Falls back to JSON.stringify so
// no information is lost.
function objectItemToString(item: Record<string, unknown>): string {
  for (const key of ["issue", "note", "message", "description", "text", "detail"]) {
    const v = item[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return JSON.stringify(item);
}

const issuesField = z
  .union([
    z.array(z.unknown()),
    z.string(),
    z.null(),
    z.undefined(),
  ])
  .transform((v) => {
    if (v === null || v === undefined) return [] as string[];
    if (typeof v === "string") {
      const trimmed = v.trim();
      return trimmed ? [trimmed] : [];
    }
    return v
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object" && !Array.isArray(item)) {
          return objectItemToString(item as Record<string, unknown>);
        }
        return JSON.stringify(item);
      })
      .map((s) => s.trim())
      .filter(Boolean);
  });

const flatReportSchema = z.object({
  medication: issuesField,
  diagnostic: issuesField,
  hallucination: issuesField,
  warningSign: issuesField,
  glossary: issuesField,
});

const AXIS_KEY_ALIASES: Record<string, string> = {
  medicationconcordance: "medication",
  medicationissues: "medication",
  medications: "medication",
  medication: "medication",
  diagnosticconcordance: "diagnostic",
  diagnosticissues: "diagnostic",
  diagnostics: "diagnostic",
  diagnostic: "diagnostic",
  hallucinationdetection: "hallucination",
  hallucinationissues: "hallucination",
  hallucinations: "hallucination",
  hallucination: "hallucination",
  warningsignappropriateness: "warningSign",
  warningsignissues: "warningSign",
  warningsigns: "warningSign",
  warningsign: "warningSign",
  glossarycoverage: "glossary",
  glossaryissues: "glossary",
  glossary: "glossary",
};

function normalizeAxisKeys(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    const lookup = key.replace(/[_\-\s]/g, "").toLowerCase();
    out[AXIS_KEY_ALIASES[lookup] ?? key] = value;
  }
  return out;
}

function buildValidatorPrompt(): string {
  return `You are a clinical-safety validator reviewing a patient-facing consultation summary against the source professional content. Your job is to detect discrepancies that could mislead or harm a patient. Do not rewrite the summary — only list issues.

You will receive two inputs:
- SOURCE: the original professional content (transcript with role labels, or a doctor's clinical report).
- SUMMARY: a patient-facing JSON summary derived from the source.

Check the summary on five axes:

1. medication — every drug, dose, and frequency in the summary must match the source. Flag missing meds, extra meds, wrong doses or frequencies.
2. diagnostic — every diagnostic conclusion in the summary must be traceable to the source. Flag conclusions added beyond the source or omitted from it.
3. hallucination — flag any factual claim in the summary that cannot be traced to a turn or section of the source (excluding stylistic plain-language rewording).
4. warningSign — red flags listed in the summary must come from what the consultant actually mentioned, not from your generic medical knowledge. Flag warning signs the source did not raise.
5. glossary — auto-generated tooltips/definitions must trace to terms actually uttered in the source. Flag definitions for terms the source never used.

Respond with EXACTLY this JSON shape (no markdown fences, no commentary). Each value is an array of short strings, one issue per string. Use an empty array [] when no issue is found on that axis.

{
  "medication": [],
  "diagnostic": [],
  "hallucination": [],
  "warningSign": [],
  "glossary": []
}

CRITICAL: write each issue in the same language as the SUMMARY. Keep each issue under 200 characters.`;
}

function buildValidatorUserMessage(
  summary: ConsultationSummary,
  sourceText: string,
): string {
  const summaryJson = JSON.stringify(
    {
      whatHappened: summary.whatHappened,
      diagnosis: summary.diagnosis,
      treatmentPlan: summary.treatmentPlan,
      followUp: summary.followUp,
      warningSigns: summary.warningSigns,
      additionalNotes: summary.additionalNotes,
      tooltips: summary.tooltips ?? {},
    },
    null,
    2,
  );
  return `## SOURCE\n\n${sourceText}\n\n## SUMMARY\n\n${summaryJson}`;
}

function emptyAxis(): ValidatorAxis {
  return { severity: "ok", notes: [] };
}

function notesToAxis(notes: string[]): ValidatorAxis {
  return notes.length === 0
    ? { severity: "ok", notes: [] }
    : { severity: "major", notes };
}

const EXPECTED_AXES = new Set([
  "medication",
  "diagnostic",
  "hallucination",
  "warningSign",
  "glossary",
]);

function parseValidatorReport(raw: string): ValidatorReport {
  const parsed = extractJson(raw);
  const obj =
    parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};

  const normalisedAxes = normalizeAxisKeys(obj);
  const recognised = Object.keys(normalisedAxes).filter((k) => EXPECTED_AXES.has(k));
  if (recognised.length === 0) {
    // The model returned JSON, but nothing we can map to the expected axes.
    // Treat as a validator failure rather than silently report "all clean".
    throw new Error("Validator response does not contain any expected axis keys");
  }
  // Be lenient with nested shapes the LLM may emit despite our prompt:
  // unwrap {severity, notes} / {issues} / {items} / etc. into a plain string list.
  const INNER_LIST_KEYS = ["notes", "issues", "flags", "items", "discrepancies", "findings"] as const;
  for (const key of Object.keys(normalisedAxes)) {
    const v = normalisedAxes[key];
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const inner = v as Record<string, unknown>;
      let unwrapped: unknown = null;
      for (const ik of INNER_LIST_KEYS) {
        if (inner[ik] !== undefined && inner[ik] !== null) {
          unwrapped = inner[ik];
          break;
        }
      }
      if (unwrapped !== null) {
        normalisedAxes[key] = unwrapped;
      } else {
        // Last-resort: collapse the object to its string values.
        const strings = Object.values(inner).filter((x) => typeof x === "string");
        normalisedAxes[key] = strings;
      }
    }
  }

  const result = flatReportSchema.safeParse(normalisedAxes);
  if (!result.success) {
    throw new Error("Invalid validator response structure");
  }
  const flat = result.data;
  return {
    medication: notesToAxis(flat.medication),
    diagnostic: notesToAxis(flat.diagnostic),
    hallucination: notesToAxis(flat.hallucination),
    warningSign: notesToAxis(flat.warningSign),
    glossary: notesToAxis(flat.glossary),
  };
}

export interface ValidationOutcome {
  status: "completed" | "failed";
  model: string;
  report: ValidatorReport | null;
  runAt: string;
}

export async function runSafetyValidation(
  summary: ConsultationSummary,
  sourceText: string,
  context: { sessionId?: string; reportSummaryId?: string } = {},
): Promise<ValidationOutcome> {
  const model = config.openWebUi.validatorModel;
  const runAt = new Date().toISOString();

  const systemPrompt = buildValidatorPrompt();
  const userMessage = buildValidatorUserMessage(summary, sourceText);

  logger.info({ ...context, model }, "Running safety validation (Step 3)");

  try {
    // Parse inside the retry: if the model returns JSON in the wrong shape,
    // the retry can produce a different sample at temperature 0.3.
    const report = await withRetry(
      async () => {
        const content = await callOpenWebUi(systemPrompt, userMessage, { model });
        return parseValidatorReport(content);
      },
      {
        operationName: "safety-validation",
        sessionId: context.sessionId,
        timeoutMs: 120_000,
        maxRetries: 2,
      },
    );

    logger.info({ ...context, model }, "Safety validation completed");
    return { status: "completed", model, report, runAt };
  } catch (error) {
    logger.warn(
      {
        ...context,
        model,
        error: error instanceof Error ? error.message : String(error),
      },
      "Safety validation failed (non-fatal)",
    );
    return { status: "failed", model, report: null, runAt };
  }
}

export function emptyValidatorReport(): ValidatorReport {
  return {
    medication: emptyAxis(),
    diagnostic: emptyAxis(),
    hallucination: emptyAxis(),
    warningSign: emptyAxis(),
    glossary: emptyAxis(),
  };
}
