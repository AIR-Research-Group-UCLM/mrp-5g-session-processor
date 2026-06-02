import { z } from "zod";
import { config } from "../config/index.js";
import { logger } from "../config/logger.js";
import { AppError } from "../middleware/error.middleware.js";
import { withRetry } from "./retry.js";

export const consultationSummarySchema = z.object({
  whatHappened: z.string(),
  diagnosis: z.string(),
  treatmentPlan: z.string(),
  followUp: z.string(),
  warningSigns: z.union([
    z.array(z.string()),
    z.string().transform((s) => [s]),
  ]),
  // Optional + nullable: smaller models (gpt-oss:20b) intermittently omit this
  // key when there is "nothing extra"; we treat absence the same as null.
  additionalNotes: z.string().nullable().optional().default(null),
});

/** Map of normalized key (lowercase, no separators) → canonical camelCase field name */
export const CANONICAL_KEYS: Record<string, string> = {
  whathappened: "whatHappened",
  what_happened: "whatHappened",
  diagnosis: "diagnosis",
  treatmentplan: "treatmentPlan",
  treatment_plan: "treatmentPlan",
  treatment: "treatmentPlan",
  followup: "followUp",
  follow_up: "followUp",
  warningsigns: "warningSigns",
  warning_signs: "warningSigns",
  warnings: "warningSigns",
  additionalnotes: "additionalNotes",
  additional_notes: "additionalNotes",
  notes: "additionalNotes",
};

export function normalizeKeys(obj: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    const lookup = key.replace(/[_-]/g, "").toLowerCase();
    const canonical = CANONICAL_KEYS[key.toLowerCase()] ?? CANONICAL_KEYS[lookup];
    normalized[canonical ?? key] = value;
  }
  return normalized;
}

// Per-model reasoning policy:
//   - gpt-oss → reasoning_effort: "medium" (only model in our fleet that
//     exposes a real reasoning knob; medium balances quality vs. latency).
//   - everything else → push every "disable thinking" toggle the upstream
//     might honour. Models that don't recognise them ignore them silently
//     (verified against gemma4:31b — accepts and discards).
type ThinkingPolicy =
  | { kind: "gpt-oss"; reasoningEffort: "medium" }
  | { kind: "disabled"; think: false; chatTemplateKwargs: { enable_thinking: false } };

function thinkingPolicyFor(model: string): ThinkingPolicy {
  if (/gpt-oss/i.test(model)) {
    return { kind: "gpt-oss", reasoningEffort: "medium" };
  }
  return {
    kind: "disabled",
    think: false,
    chatTemplateKwargs: { enable_thinking: false },
  };
}

export async function callOpenWebUi(
  systemPrompt: string,
  userMessage: string,
  options?: { model?: string; signal?: AbortSignal; maxTokens?: number },
): Promise<string> {
  if (!config.openWebUi.baseUrl || !config.openWebUi.apiKey) {
    throw new AppError(503, "Summary generation feature is not configured");
  }

  const url = `${config.openWebUi.baseUrl}/chat/completions`;
  const model = options?.model ?? config.openWebUi.model;
  const policy = thinkingPolicyFor(model);
  const startedAt = Date.now();

  logger.info(
    {
      model,
      url,
      systemPromptChars: systemPrompt.length,
      userMessageChars: userMessage.length,
      maxTokens: options?.maxTokens ?? null,
      thinkingPolicy: policy.kind,
    },
    "Open WebUI request starting",
  );

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.openWebUi.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
        temperature: 0.3,
        ...(options?.maxTokens != null ? { max_tokens: options.maxTokens } : {}),
        ...(policy.kind === "gpt-oss"
          ? { reasoning_effort: policy.reasoningEffort }
          : { think: policy.think, chat_template_kwargs: policy.chatTemplateKwargs }),
      }),
      signal: options?.signal,
    });
  } catch (error) {
    logger.warn(
      {
        model,
        url,
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      },
      "Open WebUI fetch failed before response headers arrived",
    );
    throw error;
  }

  const headersReceivedAt = Date.now();
  logger.info(
    {
      model,
      status: response.status,
      headersDurationMs: headersReceivedAt - startedAt,
    },
    "Open WebUI response headers received",
  );

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Open WebUI returned ${response.status}: ${text}`);
  }

  const data = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = data?.choices?.[0]?.message?.content;
  const totalDurationMs = Date.now() - startedAt;

  if (!content) {
    logger.warn(
      { model, totalDurationMs, body: JSON.stringify(data).slice(0, 500) },
      "Open WebUI returned no content",
    );
    throw new Error("No response content from Open WebUI");
  }

  logger.info(
    {
      model,
      totalDurationMs,
      bodyDurationMs: totalDurationMs - (headersReceivedAt - startedAt),
      contentChars: content.length,
    },
    "Open WebUI request finished",
  );

  return content;
}

export function extractJson(text: string): unknown {
  // Strip reasoning blocks (<think>...</think>, <reasoning>...</reasoning>)
  // emitted by some models before the JSON payload.
  const cleaned = text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, "")
    .trim();

  const candidates: string[] = [cleaned];

  // Markdown code block (```json ... ``` or just ``` ... ```)
  const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence?.[1]) candidates.push(fence[1].trim());

  // Balanced-brace slice from the first `{` to the matching `}`.
  const firstBrace = cleaned.indexOf("{");
  if (firstBrace !== -1) {
    let depth = 0;
    let end = -1;
    let inString = false;
    let escape = false;
    for (let i = firstBrace; i < cleaned.length; i++) {
      const ch = cleaned[i]!;
      if (escape) {
        escape = false;
        continue;
      }
      if (inString) {
        if (ch === "\\") escape = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end !== -1) candidates.push(cleaned.slice(firstBrace, end + 1));
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // try the next candidate
    }
  }

  throw new Error("Failed to extract JSON from response");
}

export function validateAndParseSummary(content: string): z.infer<typeof consultationSummarySchema> {
  const raw = extractJson(content);
  const parsed = raw && typeof raw === "object" && !Array.isArray(raw)
    ? normalizeKeys(raw as Record<string, unknown>)
    : raw;
  const result = consultationSummarySchema.safeParse(parsed);

  if (!result.success) {
    logger.error(
      {
        issues: result.error.issues,
        rawKeys:
          parsed && typeof parsed === "object" && !Array.isArray(parsed)
            ? Object.keys(parsed as Record<string, unknown>)
            : null,
        contentChars: content.length,
        contentPreview: content.slice(0, 1500),
      },
      "Invalid summary response structure from LLM",
    );
    throw new Error("Invalid summary response structure from LLM");
  }

  return result.data;
}

/**
 * Build a complete system prompt for patient-friendly summary generation.
 * @param sourceDescription - describes the input, e.g. "the raw transcript of a medical consultation (with speaker roles and section types)" or "a doctor's medical report about a patient consultation"
 * @param languageInstruction - e.g. "Generate ALL text in Spanish" or "Generate ALL text in the same language as the doctor's report"
 */
export function buildSummaryPrompt(sourceDescription: string, languageInstruction: string): string {
  return `You are a medical communication specialist. Given ${sourceDescription}, generate a clear, patient-friendly explanation of the consultation.

Write as if you are explaining directly to the patient what happened during their visit. Use simple, non-technical language that a patient without medical training can understand.

${buildJsonFormatSpec()}

${buildCommonRules(languageInstruction)}`;
}

export function buildJsonFormatSpec(): string {
  return `Respond in JSON with EXACTLY this shape (all six keys are required, spelled exactly as shown — do not translate, shorten, or rename them):
{
  "whatHappened": "A clear summary of what took place during the consultation",
  "diagnosis": "What the doctor found or suspects, explained simply",
  "treatmentPlan": "What the patient needs to do (medications, lifestyle changes, etc.)",
  "followUp": "Next steps, when to come back, what appointments to schedule",
  "warningSigns": ["Sign 1 to watch for", "Sign 2 to watch for"],
  "additionalNotes": "Any other important information, or null if none"
}`;
}

export function buildCommonRules(languageInstruction: string): string {
  return `IMPORTANT RULES:
- Use simple, everyday language — avoid medical jargon
- Be reassuring but honest
- If warning signs were mentioned, list them clearly
- If there is no information for a field, provide a reasonable "No specific information was discussed" message
- additionalNotes should be null if there is nothing extra to add, but the key must still appear in the response
- warningSigns must always be a JSON array (use [] if there are no warning signs)
- Use the English keys exactly as listed above; only the VALUES are translated
- CRITICAL: ${languageInstruction}`;
}

/**
 * Strip wrappers a model may add around plain prose: <think>/<reasoning>
 * blocks, code fences, JSON envelopes (`{ "value": "..." }`), and surrounding
 * quotes. Used by the per-field fallback path which expects raw text.
 */
function cleanScalarFieldResponse(text: string): string {
  let cleaned = text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, "")
    .trim();

  const fence = cleaned.match(/```(?:json|text|markdown)?\s*([\s\S]*?)```/);
  if (fence?.[1]) cleaned = fence[1].trim();

  if (cleaned.startsWith("{") || cleaned.startsWith("[")) {
    try {
      const parsed = JSON.parse(cleaned);
      if (typeof parsed === "string") {
        cleaned = parsed;
      } else if (Array.isArray(parsed) && parsed.every((p) => typeof p === "string")) {
        cleaned = parsed.join("\n");
      } else if (parsed && typeof parsed === "object") {
        const firstString = Object.values(parsed as Record<string, unknown>).find(
          (v): v is string => typeof v === "string",
        );
        if (firstString) cleaned = firstString;
      }
    } catch {
      // not JSON; keep as-is
    }
  }

  return cleaned.replace(/^["']|["']$/g, "").trim();
}

interface PerFieldOptions {
  sessionId?: string;
}

// Per-field calls run in parallel against gpt-oss:20b, which under
// reasoning_effort: "medium" can spend 100s+ on a single field for dense
// transcripts. Cap generously so a slow field doesn't kill the batch.
const PER_FIELD_TIMEOUT_MS = 180_000;
const PER_FIELD_MAX_RETRIES = 2;
// Bound output length to prevent the model from rambling indefinitely (which
// also stretches reasoning time). Sized generously for one paragraph / one
// short JSON array.
const PER_FIELD_SCALAR_MAX_TOKENS = 800;
const PER_FIELD_WARNING_SIGNS_MAX_TOKENS = 600;
const NO_INFO_PLACEHOLDER = "No specific information was discussed";

async function generateScalarField(
  fieldKey: string,
  fieldDescription: string,
  sourceDescription: string,
  languageInstruction: string,
  userMessage: string,
  options?: PerFieldOptions,
): Promise<string> {
  const systemPrompt = `You are a medical communication specialist. Given ${sourceDescription}, write ONLY the "${fieldKey}" portion of a patient-friendly consultation summary.

What "${fieldKey}" means: ${fieldDescription}

Use simple, everyday language — avoid medical jargon. Be reassuring but honest.

Respond with ONE plain-text paragraph and nothing else. No JSON. No code fences. No markdown. No "${fieldKey}:" prefix. No quotation marks wrapping the response. No extra commentary before or after. Just the prose itself, ready to be shown to the patient.

If the source has no information about "${fieldKey}", respond with exactly: "${NO_INFO_PLACEHOLDER}"

CRITICAL: ${languageInstruction}`;

  const content = await withRetry(
    () => callOpenWebUi(systemPrompt, userMessage, { maxTokens: PER_FIELD_SCALAR_MAX_TOKENS }),
    {
      operationName: `summary-field[${fieldKey}]`,
      sessionId: options?.sessionId,
      timeoutMs: PER_FIELD_TIMEOUT_MS,
      maxRetries: PER_FIELD_MAX_RETRIES,
    },
  );

  const cleaned = cleanScalarFieldResponse(content);
  return cleaned.length > 0 ? cleaned : NO_INFO_PLACEHOLDER;
}

async function generateWarningSignsField(
  sourceDescription: string,
  languageInstruction: string,
  userMessage: string,
  options?: PerFieldOptions,
): Promise<string[]> {
  const systemPrompt = `You are a medical communication specialist. Given ${sourceDescription}, list the warning signs that should prompt the patient to seek urgent medical care.

Respond with ONLY a JSON array of short strings — one warning sign per array element. No prose, no markdown, no code fences, no commentary. If no warning signs were discussed, respond with exactly: []

CRITICAL: ${languageInstruction}`;

  const content = await withRetry(
    () =>
      callOpenWebUi(systemPrompt, userMessage, { maxTokens: PER_FIELD_WARNING_SIGNS_MAX_TOKENS }),
    {
      operationName: "summary-field[warningSigns]",
      sessionId: options?.sessionId,
      timeoutMs: PER_FIELD_TIMEOUT_MS,
      maxRetries: PER_FIELD_MAX_RETRIES,
    },
  );

  try {
    const raw = extractJson(content);
    const result = z
      .union([z.array(z.string()), z.string().transform((s) => [s])])
      .safeParse(raw);
    if (result.success) return result.data;
  } catch {
    // fall through to line-split salvage
  }

  // Last-ditch salvage: treat as bullet/newline list. Filters absurdly long
  // lines (likely prose, not signs) so we don't poison the schema.
  return content
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, "")
    .split(/\n+/)
    .map((line) => line.replace(/^[-*•·\d.)\s]+/, "").trim())
    .filter((line) => line.length > 0 && line.length < 500);
}

/**
 * Per-field fallback: when the all-at-once JSON request keeps coming back
 * malformed (e.g. gpt-oss:20b inventing its own discharge-note schema), ask
 * the model for one field at a time as plain prose. Single-field prompts are
 * dramatically harder to derail. Runs the five required fields in parallel;
 * additionalNotes is intentionally skipped and defaulted to null.
 */
export async function generateSummaryFieldsPerField(
  sourceDescription: string,
  languageInstruction: string,
  userMessage: string,
  options?: PerFieldOptions,
): Promise<SummaryFields> {
  logger.info(
    { sessionId: options?.sessionId },
    "Generating consultation summary per-field (fallback)",
  );

  const [whatHappened, diagnosis, treatmentPlan, followUp, warningSigns] = await Promise.all([
    generateScalarField(
      "whatHappened",
      "A clear summary of what took place during the consultation.",
      sourceDescription,
      languageInstruction,
      userMessage,
      options,
    ),
    generateScalarField(
      "diagnosis",
      "What the doctor found or suspects, explained simply.",
      sourceDescription,
      languageInstruction,
      userMessage,
      options,
    ),
    generateScalarField(
      "treatmentPlan",
      "What the patient needs to do (medications, lifestyle changes, etc.).",
      sourceDescription,
      languageInstruction,
      userMessage,
      options,
    ),
    generateScalarField(
      "followUp",
      "Next steps, when to come back, what appointments to schedule.",
      sourceDescription,
      languageInstruction,
      userMessage,
      options,
    ),
    generateWarningSignsField(sourceDescription, languageInstruction, userMessage, options),
  ]);

  return {
    whatHappened,
    diagnosis,
    treatmentPlan,
    followUp,
    warningSigns,
    additionalNotes: null,
  };
}

interface SummaryGenerationOptions extends PerFieldOptions {
  operationName?: string;
  timeoutMs?: number;
  maxRetries?: number;
  maxTokens?: number;
}

// All-at-once budget. Gives the model room for a full six-field JSON object
// without rambling — if it cannot fit the answer in this many tokens, the
// per-field fallback will pick up the slack.
const ALL_AT_ONCE_DEFAULT_TIMEOUT_MS = 240_000;
const ALL_AT_ONCE_DEFAULT_MAX_TOKENS = 2000;

/**
 * Generate the structured summary fields, with a robust fallback path:
 *   1. Try the all-at-once JSON prompt (with validation INSIDE the retry, so
 *      a malformed response retries the LLM call rather than failing fast).
 *   2. If retries are exhausted, fall back to per-field generation: one LLM
 *      call per scalar field as plain prose, plus one for warningSigns as a
 *      JSON array. Single-field prompts resist the "model invents its own
 *      schema" failure mode that derails the all-at-once path on dense
 *      transcripts.
 */
export async function generateSummaryFields(
  sourceDescription: string,
  languageInstruction: string,
  userMessage: string,
  options?: SummaryGenerationOptions,
): Promise<SummaryFields> {
  const operationName = options?.operationName ?? "summary-generation";
  const timeoutMs = options?.timeoutMs ?? ALL_AT_ONCE_DEFAULT_TIMEOUT_MS;
  const maxRetries = options?.maxRetries ?? 2;
  const maxTokens = options?.maxTokens ?? ALL_AT_ONCE_DEFAULT_MAX_TOKENS;
  const systemPrompt = buildSummaryPrompt(sourceDescription, languageInstruction);

  try {
    return await withRetry(
      async () => {
        const content = await callOpenWebUi(systemPrompt, userMessage, { maxTokens });
        return validateAndParseSummary(content);
      },
      {
        operationName,
        sessionId: options?.sessionId,
        timeoutMs,
        maxRetries,
      },
    );
  } catch (error) {
    logger.warn(
      {
        sessionId: options?.sessionId,
        operationName,
        error: error instanceof Error ? error.message : String(error),
      },
      "All-at-once summary failed; falling back to per-field generation",
    );
    return generateSummaryFieldsPerField(sourceDescription, languageInstruction, userMessage, {
      sessionId: options?.sessionId,
    });
  }
}

const tooltipsSchema = z.record(z.string(), z.string());

/**
 * Make a second LLM call to identify medical/technical terms in the summary
 * and provide plain-language explanations. Returns null on failure (non-critical).
 */
/** The summary fields produced by the first LLM call (before tooltips are added). */
export type SummaryFields = z.infer<typeof consultationSummarySchema>;

// Tooltips are non-critical — bound the wall time so a stalled upstream cannot
// hang the parent request indefinitely. No retry: a slow first attempt is far
// more often a stuck connection than a transient blip, and tooltips already
// soft-fail to null on any error.
const TOOLTIPS_TIMEOUT_MS = 60_000;

export async function generateTooltips(
  summary: SummaryFields,
): Promise<Record<string, string> | null> {
  const summaryText = [
    summary.whatHappened,
    summary.diagnosis,
    summary.treatmentPlan,
    summary.followUp,
    ...summary.warningSigns,
    summary.additionalNotes,
  ]
    .filter(Boolean)
    .join("\n\n");

  const systemPrompt = `Given this patient-facing medical summary, identify terms that a patient might not understand. Return a JSON object where each key is the exact term as it appears in the text and each value is a brief, simple explanation (one sentence max).

Only include terms that genuinely need explanation — skip everyday words. Return an empty object \`{}\` if all terms are already simple enough.

CRITICAL: Generate explanations in the same language as the summary.`;

  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), TOOLTIPS_TIMEOUT_MS);

  try {
    const content = await callOpenWebUi(systemPrompt, summaryText, { signal: controller.signal });
    const raw = extractJson(content);
    const result = tooltipsSchema.safeParse(raw);

    if (!result.success) {
      logger.warn({ errors: result.error.issues }, "Invalid tooltips response structure");
      return null;
    }

    return Object.keys(result.data).length > 0 ? result.data : null;
  } catch (error) {
    const aborted = controller.signal.aborted;
    logger.warn(
      {
        aborted,
        timeoutMs: aborted ? TOOLTIPS_TIMEOUT_MS : undefined,
        error: error instanceof Error ? error.message : String(error),
      },
      aborted
        ? "Tooltip generation aborted at timeout (non-critical)"
        : "Tooltip generation failed (non-critical)",
    );
    return null;
  } finally {
    clearTimeout(timeoutHandle);
  }
}
