import { z } from "zod";
import { config } from "../config/index.js";
import { logger } from "../config/logger.js";
import { AppError } from "../middleware/error.middleware.js";

export const consultationSummarySchema = z.object({
  whatHappened: z.string(),
  diagnosis: z.string(),
  treatmentPlan: z.string(),
  followUp: z.string(),
  warningSigns: z.union([
    z.array(z.string()),
    z.string().transform((s) => [s]),
  ]),
  additionalNotes: z.string().nullable(),
});

/** Map of normalized key (lowercase, no separators) → canonical camelCase field name */
export const CANONICAL_KEYS: Record<string, string> = {
  whathappened: "whatHappened",
  what_happened: "whatHappened",
  diagnosis: "diagnosis",
  treatmentplan: "treatmentPlan",
  treatment_plan: "treatmentPlan",
  followup: "followUp",
  follow_up: "followUp",
  warningsigns: "warningSigns",
  warning_signs: "warningSigns",
  additionalnotes: "additionalNotes",
  additional_notes: "additionalNotes",
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
  return `Respond in JSON with the following format:
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
- additionalNotes should be null if there is nothing extra to add
- CRITICAL: ${languageInstruction}`;
}

const tooltipsSchema = z.record(z.string(), z.string());

/**
 * Make a second LLM call to identify medical/technical terms in the summary
 * and provide plain-language explanations. Returns null on failure (non-critical).
 */
/** The summary fields produced by the first LLM call (before tooltips are added). */
export type SummaryFields = z.infer<typeof consultationSummarySchema>;

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

  try {
    const content = await callOpenWebUi(systemPrompt, summaryText);
    const raw = extractJson(content);
    const result = tooltipsSchema.safeParse(raw);

    if (!result.success) {
      logger.warn({ errors: result.error.issues }, "Invalid tooltips response structure");
      return null;
    }

    return Object.keys(result.data).length > 0 ? result.data : null;
  } catch (error) {
    logger.warn(
      { error: error instanceof Error ? error.message : String(error) },
      "Tooltip generation failed (non-critical)",
    );
    return null;
  }
}
