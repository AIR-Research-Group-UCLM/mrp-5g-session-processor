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

// One LLM call per axis. The model only has to evaluate ONE concern at a time,
// which keeps prompts small (faster generation, far less likely to hit the
// per-call timeout) and the expected JSON shape trivial (an array of strings,
// or a single string, or null) — within the instruction-following budget of
// smaller open-weight models like gpt-oss:20b.
//
// Run the four LLM axes in parallel. With serial execution the request can
// outlive an upstream proxy timeout (4 × per-axis budget), and Open WebUI
// handles the concurrent load fine in practice — verified empirically.
const SAFETY_VALIDATOR_PARALLEL = true;
const AXIS_TIMEOUT_MS = 120_000;
// `withRetry` reads this as the max ATTEMPTS cap (not extra retries on top of
// the first try). With gpt-oss:20b a successful axis routinely needs 60–110 s
// of reasoning, and parallel mode means total wall time = max(per-axis time).
// So 1 attempt × 120 s timeout = 120 s worst case, which fits inside a typical
// proxy timeout. Bumping to 2 doubles the worst case to ~240 s.
//
// Per-axis failures are absorbed by the soft-fail path in runSafetyValidation
// (the failed axis defaults to "ok"/empty, the request still returns a usable
// report), and the looser parser below recovers most legitimate-but-misshapen
// responses without needing a retry. Net effect: a single attempt is the
// reliability sweet spot for this model + this validator design.
const AXIS_MAX_RETRIES = 1;
// Cap each axis response at ~500 tokens (≈ 1.5–2 kB). Combined with the
// "top N most relevant issues" instruction, this prevents runaway generations
// that previously stretched per-axis latency into the timeout window.
const AXIS_MAX_OUTPUT_TOKENS = 500;
const AXIS_MAX_ISSUES = 5;

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

// Per-axis response: array of strings, a single string (one issue), or null.
const issuesField = z
  .union([z.array(z.unknown()), z.string(), z.null(), z.undefined()])
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

interface AxisDefinition {
  key: keyof ValidatorReport;
  label: string;
  description: string;
  rule: string;
}

const AXIS_DEFINITIONS: readonly AxisDefinition[] = [
  {
    key: "medication",
    label: "medication",
    description: "drugs, doses, and frequencies",
    rule: "Every drug, dose, and frequency in the SUMMARY must match the SOURCE. Flag missing meds, extra meds, wrong doses, or wrong frequencies.",
  },
  {
    key: "diagnostic",
    label: "diagnostic",
    description: "diagnostic conclusions",
    rule: "Every diagnostic conclusion in the SUMMARY must be traceable to the SOURCE. Flag conclusions added beyond the SOURCE or omitted from it.",
  },
  {
    key: "hallucination",
    label: "hallucination",
    description: "untraceable factual claims",
    rule: "Flag any factual claim in the SUMMARY that cannot be traced to a turn or section of the SOURCE (excluding stylistic plain-language rewording).",
  },
  {
    key: "warningSign",
    label: "warningSign",
    description: "red-flag advice appropriateness",
    rule: "Red flags listed in the SUMMARY must come from what the consultant actually mentioned, not from generic medical knowledge. Flag warning signs the SOURCE did not raise.",
  },
  // glossary is computed deterministically (see computeGlossaryAxis) — it does
  // not need an LLM, since the check is "tooltip key appears verbatim in SOURCE".
] as const;

function buildAxisPrompt(axis: AxisDefinition): string {
  return `You are a clinical-safety validator. Compare the patient-facing SUMMARY against the original professional SOURCE on a single axis: ${axis.label} (${axis.description}).

You will receive:
- SOURCE: the original professional content (transcript with role labels, or a doctor's clinical report).
- SUMMARY: a patient-facing JSON summary derived from the SOURCE.

Rule: ${axis.rule}

Respond with EXACTLY a JSON object containing a single key "issues" — no markdown fences, no commentary, no bare strings, no bare arrays. Do NOT echo the SUMMARY back. Do NOT include keys like "whatHappened", "diagnosis", "treatmentPlan", "followUp", "warningSigns", "additionalNotes", or "tooltips" — those belong in the SUMMARY input, not in your response. The value of "issues" must be one of:
- An empty array if there is no issue: {"issues": []}
- An array of short strings, one issue per element: {"issues": ["issue 1", "issue 2"]}

EXAMPLE (medication axis):
  SOURCE excerpt: "Patient on apixaban 2.5 mg twice daily."
  SUMMARY excerpt: {"treatmentPlan": "Take apixaban 2.5 mg once a day."}
  Your response: {"issues": ["Apixaban frequency mismatch: summary says once daily, source says twice daily."]}

CRITICAL: write each issue in the same language as the SUMMARY. Keep each issue under 200 characters. List AT MOST ${AXIS_MAX_ISSUES} issues — if more exist, prioritise the highest patient-safety risk first and omit the rest.`;
}

// Per-axis pruning: gpt-oss:20b reliably fails on large prompts (>10 KB user
// message), regenerating the SUMMARY in patient-facing prose instead of
// validating. For 3 of 4 axes only one SUMMARY field is relevant, so we pass
// that field alone — far less SUMMARY structure for the model to copy. For
// the hallucination axis we keep every factual field but drop tooltips
// (descriptive, not subject to source traceability).
function buildValidatorUserMessage(
  summary: ConsultationSummary,
  sourceText: string,
  axisLabel: AxisDefinition["label"],
): string {
  const relevant: Record<string, unknown> = (() => {
    switch (axisLabel) {
      case "medication":
        return { treatmentPlan: summary.treatmentPlan };
      case "diagnostic":
        return { diagnosis: summary.diagnosis };
      case "warningSign":
        return { warningSigns: summary.warningSigns };
      case "hallucination":
      default:
        return {
          whatHappened: summary.whatHappened,
          diagnosis: summary.diagnosis,
          treatmentPlan: summary.treatmentPlan,
          followUp: summary.followUp,
          warningSigns: summary.warningSigns,
          additionalNotes: summary.additionalNotes,
        };
    }
  })();
  const summaryJson = JSON.stringify(relevant, null, 2);
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

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Whole-word, case-insensitive, Unicode-aware match. Lookbehind/lookahead with
// \p{L} avoid both ASCII-only \b and substring false-positives like "ITU"
// matching inside "instituto".
function termAppearsInSource(term: string, source: string): boolean {
  const trimmed = term.trim();
  if (!trimmed) return true;
  const re = new RegExp(`(?<!\\p{L})${escapeRegex(trimmed)}(?!\\p{L})`, "iu");
  return re.test(source);
}

// Note marker the frontend translates: `__i18n__{"key":"...","values":{...}}`.
// LLM-generated notes pass through verbatim; only deterministic notes use this
// marker so they can be rendered in the active UI language.
function i18nNote(key: string, values: Record<string, string | number>): string {
  return `__i18n__${JSON.stringify({ key, values })}`;
}

function computeGlossaryAxis(
  summary: ConsultationSummary,
  sourceText: string,
): ValidatorAxis {
  const tooltips = summary.tooltips ?? {};
  const terms = Object.keys(tooltips);
  if (terms.length === 0) return { severity: "ok", notes: [] };

  const notes: string[] = [];
  for (const term of terms) {
    if (!termAppearsInSource(term, sourceText)) {
      notes.push(i18nNote("validator.notes.glossaryTermMissing", { term }));
    }
  }
  return notesToAxis(notes);
}

// Keys that uniquely identify a ConsultationSummary — if the model echoes the
// SUMMARY back instead of producing {"issues": [...]}, the response will hit
// at least two of these. Detect explicitly so the retry logs a clear cause
// rather than an opaque zod-union error chain.
const SUMMARY_ECHO_KEYS = [
  "whatHappened",
  "diagnosis",
  "treatmentPlan",
  "followUp",
  "warningSigns",
  "additionalNotes",
  "tooltips",
] as const;

// Negation noun stems the model uses across English and Spanish to mean
// "nothing wrong here". Matched whole-word inside `looksLikeNoIssuesAnswer`.
const NO_ISSUES_NOUN_REGEX =
  /(?:^|\W)(?:no|sin|without)\s+(?:issues?|hallucinat\w+|problems?|errors?|inaccuracies|inaccuracy|discrepan\w+|factual\s+claims?|alucinacion\w+|errores|problemas|cuestiones|reclamacion\w+|incoherencias)/i;
const SUMMARY_AFFIRMATION_REGEX =
  /\b(?:summary|resumen)\b[^.!?\n]{0,80}\b(?:accurate|correct|faithful|consistent|preciso|correcto|exacto|fiel|coherente)\b/i;

// gpt-oss:20b occasionally answers a "no issues" axis check with a short
// natural-language reply ("No.", "No hallucinations detected.", "The summary
// is accurate.") instead of `{"issues": []}`. Recover that case so a benign
// answer doesn't cost a retry. Conservative on purpose: short, no JSON tokens,
// and either a one-word negation or an explicit "no <noun>" / "summary is
// accurate" pattern.
function looksLikeNoIssuesAnswer(raw: string): boolean {
  const cleaned = raw
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, "")
    .trim();
  if (cleaned.length === 0 || cleaned.length > 400) return false;
  if (cleaned.includes("{") || cleaned.includes("[")) return false;
  if (/^(?:no|none|n\/a|nada|ninguno|ninguna)[.!]?$/i.test(cleaned)) return true;
  return NO_ISSUES_NOUN_REGEX.test(cleaned) || SUMMARY_AFFIRMATION_REGEX.test(cleaned);
}

function parseAxisResponse(raw: string, axis: AxisDefinition): string[] {
  // Some open-weight models bail out of JSON entirely and reply with a short
  // affirmation that nothing is wrong. Treat that as a clean zero-issues
  // answer instead of forcing a retry on a semantically valid response.
  if (looksLikeNoIssuesAnswer(raw)) return [];

  const parsed = extractJson(raw);

  // Tolerate bare arrays — gpt-oss occasionally drops the `{"issues": ...}`
  // envelope and returns the array directly (or `[]` for no issues). Accept
  // both shapes; `issuesField` still normalises objects-inside-arrays.
  if (Array.isArray(parsed)) {
    return issuesField.parse(parsed);
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error(
      `Expected JSON object or array for axis "${axis.label}", got ${
        parsed === null ? "null" : typeof parsed
      }`,
    );
  }

  const obj = parsed as Record<string, unknown>;
  const keys = Object.keys(obj);
  if (keys.length === 0) {
    throw new Error(`Empty JSON object for axis "${axis.label}"`);
  }

  // Echo guard: ≥2 SUMMARY-shaped keys means the model regenerated the input
  // instead of producing issues. Bail with a specific message so the retry
  // doesn't fight a downstream zod-union error.
  const echoHits = keys.filter((k) => (SUMMARY_ECHO_KEYS as readonly string[]).includes(k));
  if (echoHits.length >= 2) {
    throw new Error(
      `Response echoes the SUMMARY shape (keys: ${echoHits.join(", ")}) instead of {"issues": [...]} for axis "${axis.label}"`,
    );
  }

  // Prompt asks for a single key, but tolerate multiple by unioning their
  // values. Each value must parse as string|array via issuesField; nested
  // shapes still fall back through objectItemToString for items inside arrays.
  const allNotes: string[] = [];
  for (const key of keys) {
    allNotes.push(...issuesField.parse(obj[key]));
  }
  return allNotes;
}

export interface ValidationOutcome {
  status: "completed" | "failed";
  model: string;
  report: ValidatorReport | null;
  runAt: string;
}

async function runValidationForAxis(
  summary: ConsultationSummary,
  sourceText: string,
  model: string,
  axis: AxisDefinition,
  context: { sessionId?: string; reportSummaryId?: string },
): Promise<string[] | null> {
  const systemPrompt = buildAxisPrompt(axis);
  const userMessage = buildValidatorUserMessage(summary, sourceText, axis.label);

  try {
    return await withRetry(
      async () => {
        const attemptStart = Date.now();
        // Tie the fetch lifetime to the per-attempt timeout so a hung Open WebUI
        // request is actually cancelled instead of running on while withRetry
        // moves on to the next attempt.
        const controller = new AbortController();
        const timeoutHandle = setTimeout(() => controller.abort(), AXIS_TIMEOUT_MS);
        try {
          const content = await callOpenWebUi(systemPrompt, userMessage, {
            model,
            signal: controller.signal,
            maxTokens: AXIS_MAX_OUTPUT_TOKENS,
          });
          logger.info(
            {
              ...context,
              model,
              axis: axis.label,
              durationMs: Date.now() - attemptStart,
              contentLength: content.length,
              content,
            },
            "Safety validator axis raw LLM response",
          );
          try {
            return parseAxisResponse(content, axis);
          } catch (parseError) {
            logger.warn(
              {
                ...context,
                model,
                axis: axis.label,
                error: parseError instanceof Error ? parseError.message : String(parseError),
                content,
              },
              "Safety validator axis response failed to parse (will retry if attempts remain)",
            );
            throw parseError;
          }
        } catch (error) {
          if (controller.signal.aborted) {
            logger.warn(
              {
                ...context,
                model,
                axis: axis.label,
                durationMs: Date.now() - attemptStart,
              },
              "Safety validator axis LLM call aborted (per-attempt timeout fired)",
            );
          }
          throw error;
        } finally {
          clearTimeout(timeoutHandle);
        }
      },
      {
        operationName: `safety-validation[${axis.label}]`,
        sessionId: context.sessionId,
        timeoutMs: AXIS_TIMEOUT_MS,
        maxRetries: AXIS_MAX_RETRIES,
      },
    );
  } catch (error) {
    logger.warn(
      {
        ...context,
        model,
        axis: axis.label,
        error: error instanceof Error ? error.message : String(error),
      },
      "Safety validator axis failed after retries",
    );
    return null;
  }
}

export async function runSafetyValidation(
  summary: ConsultationSummary,
  sourceText: string,
  context: { sessionId?: string; reportSummaryId?: string } = {},
): Promise<ValidationOutcome> {
  const model = config.openWebUi.validatorModel;
  const runAt = new Date().toISOString();

  logger.info(
    {
      ...context,
      model,
      sourceTextChars: sourceText.length,
      axisCount: AXIS_DEFINITIONS.length,
      mode: SAFETY_VALIDATOR_PARALLEL ? "parallel" : "serial",
      perAxisTimeoutMs: AXIS_TIMEOUT_MS,
    },
    "Running safety validation (Step 3)",
  );

  let perAxisResults: (string[] | null)[];
  if (SAFETY_VALIDATOR_PARALLEL) {
    perAxisResults = await Promise.all(
      AXIS_DEFINITIONS.map((axis) =>
        runValidationForAxis(summary, sourceText, model, axis, context),
      ),
    );
  } else {
    perAxisResults = [];
    for (const axis of AXIS_DEFINITIONS) {
      perAxisResults.push(
        await runValidationForAxis(summary, sourceText, model, axis, context),
      );
    }
  }

  const successfulCount = perAxisResults.filter((r) => r !== null).length;

  if (successfulCount === 0) {
    logger.warn(
      { ...context, model, axisCount: AXIS_DEFINITIONS.length },
      "Safety validation failed: every axis failed",
    );
    return { status: "failed", model, report: null, runAt };
  }

  const report = emptyValidatorReport();
  AXIS_DEFINITIONS.forEach((axis, idx) => {
    const notes = perAxisResults[idx];
    if (notes != null) {
      report[axis.key] = notesToAxis(notes);
    }
    // Failed axes stay as the default "ok"/empty — partial failure is logged
    // above; we don't have a per-axis "unknown" severity to express it cleanly.
  });

  // Glossary is deterministic — always populated alongside the LLM axes.
  report.glossary = computeGlossaryAxis(summary, sourceText);

  logger.info(
    {
      ...context,
      model,
      successfulAxes: successfulCount,
      totalAxes: AXIS_DEFINITIONS.length,
      glossaryNotes: report.glossary.notes.length,
    },
    "Safety validation completed",
  );

  return { status: "completed", model, report, runAt };
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
