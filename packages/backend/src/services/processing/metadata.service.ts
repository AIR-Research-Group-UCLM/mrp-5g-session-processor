import { getLanguageName } from "@mrp/shared";
import OpenAI from "openai";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import { config } from "../../config/index.js";
import { getDb } from "../../db/connection.js";
import { logger } from "../../config/logger.js";

// Security: Zod schemas for validating OpenAI metadata response
const clinicalIndicatorsSchema = z.object({
  urgencyLevel: z.string().nullable().optional(),
  appointmentPriority: z.string().nullable().optional(),
  reasonForVisit: z.string().nullable().optional(),
  consultedSpecialty: z.string().nullable().optional(),
  mainClinicalProblem: z.string().nullable().optional(),
  problemStatus: z.string().nullable().optional(),
  diagnosticHypothesis: z.array(z.object({
    condition: z.string(),
    certainty: z.string(),
  })).nullable().optional(),
  requestedTests: z.array(z.string()).nullable().optional(),
  treatmentPlan: z.object({
    medicationStarted: z.array(z.string()).optional(),
    medicationAdjusted: z.array(z.string()).optional(),
    medicationDiscontinued: z.array(z.string()).optional(),
    nonPharmacologicalMeasures: z.array(z.string()).optional(),
  }).nullable().optional(),
  patientEducation: z.array(z.string()).nullable().optional(),
  warningSigns: z.array(z.string()).nullable().optional(),
  followUpPlan: z.object({
    followUpType: z.string().optional(),
    timeFrame: z.string().optional(),
    responsibleCareLevel: z.string().optional(),
  }).nullable().optional(),
}).optional();

const metadataResponseSchema = z.object({
  summary: z.string(),
  keywords: z.array(z.string()),
  title: z.string().optional(),
  userTags: z.array(z.string()).optional(),
  clinicalIndicators: clinicalIndicatorsSchema,
});

const openai = new OpenAI({
  apiKey: config.openai.apiKey,
});

interface TranscriptSection {
  section_type: string;
  content: string;
}

interface SessionInfo {
  title: string | null;
  user_tags: string | null;
}

function buildMetadataPrompt(needsTitle: boolean, needsTags: boolean, outputLanguage: string): string {
  let fieldNum = 1;
  const fields: string[] = [
    `${fieldNum++}. A brief summary (2-3 sentences) of the consultation content`,
    `${fieldNum++}. Relevant keywords (5-10 terms) that help search this session`,
  ];

  if (needsTitle) {
    fields.push(`${fieldNum++}. A descriptive and concise title (maximum 10 words) to identify this session`);
  }

  if (needsTags) {
    fields.push(`${fieldNum++}. Categorization tags (3-5) to organize the session`);
  }

  fields.push(`${fieldNum++}. Structured clinical indicators according to the provided schema`);

  const languageName = getLanguageName(outputLanguage);

  return `You are an expert in medical consultation analysis. Given the segmented transcript of a medical session, generate:

${fields.join('\n')}

Respond in JSON with the following format:
{
  "summary": "Summary of the consultation...",
  "keywords": ["keyword1", "keyword2", ...]${needsTitle ? `,
  "title": "Session title"` : ''}${needsTags ? `,
  "userTags": ["tag1", "tag2", ...]` : ''},
  "clinicalIndicators": {
    "urgencyLevel": "low" | "medium" | "high",
    "appointmentPriority": "preferred" | "non_preferred",
    "reasonForVisit": "Main reason for consultation",
    "consultedSpecialty": "Medical specialty if applicable, or null",
    "mainClinicalProblem": "Main clinical problem addressed",
    "problemStatus": "new" | "chronic" | "exacerbation" | "follow_up" | "resolved",
    "diagnosticHypothesis": [
      {"condition": "Diagnosis name", "certainty": "confirmed" | "probable" | "to_be_ruled_out"}
    ],
    "requestedTests": ["test1", "test2"],
    "treatmentPlan": {
      "medicationStarted": ["medication1"],
      "medicationAdjusted": ["medication2"],
      "medicationDiscontinued": [],
      "nonPharmacologicalMeasures": ["measure1"]
    },
    "patientEducation": ["Health education provided"],
    "warningSigns": ["Warning signs communicated"],
    "followUpPlan": {
      "followUpType": "review" | "referral" | "discharge",
      "timeFrame": "Follow-up timeframe",
      "responsibleCareLevel": "primary_care" | "specialist" | "emergency"
    }
  }
}

Keywords should include:
- Symptoms mentioned
- Diagnoses discussed
- Recommended treatments
- Relevant medical terms${needsTitle ? `

The title should be descriptive but brief, for example:
- "Acute abdominal pain consultation"
- "Hypertension follow-up"
- "Initial visit: recurrent headache"` : ''}${needsTags ? `

Tags should be general categories useful for filtering, for example:
- Consultation type: "initial visit", "follow-up", "urgent"
- Specialty: "cardiology", "neurology", "general medicine"
- Age group if relevant: "pediatric", "geriatric"` : ''}

IMPORTANT NOTES for clinical indicators:
- urgencyLevel: Evaluate urgency based on symptom severity, evolution, or need for immediate action
- appointmentPriority: "preferred" if priority appointment is mentioned, "non_preferred" otherwise
- problemStatus: "new" for new problems, "chronic" for chronic ones, "exacerbation" for acute worsening, "follow_up" for follow-up, "resolved" if resolved
- diagnosticHypothesis: List of diagnoses mentioned with their certainty level
- requestedTests: Diagnostic tests requested (labs, X-rays, etc.)
- treatmentPlan: Separate medications started, adjusted, and discontinued; include non-pharmacological measures
- patientEducation: Advice and explanations given to the patient
- warningSigns: Warning signs for which the patient should seek emergency care
- followUpPlan: Type of follow-up (review, referral, or discharge), timeframe, and responsible care level
- If there is insufficient information for a field, use null or an empty array as appropriate

CRITICAL: Generate ALL text content (summary, keywords, title, tags, clinical indicators text) in ${languageName}.`;
}

interface SessionInfoWithLanguage extends SessionInfo {
  language: string | null;
}

export interface MetadataCostResult {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export async function processMetadata(sessionId: string): Promise<MetadataCostResult> {
  const db = getDb();

  // Check if title and tags already exist, and get language
  const sessionInfo = db
    .prepare("SELECT title, user_tags, language FROM medical_sessions WHERE id = ?")
    .get(sessionId) as SessionInfoWithLanguage | undefined;

  const needsTitle = !sessionInfo?.title;
  const needsTags = !sessionInfo?.user_tags;
  const outputLanguage = sessionInfo?.language ?? "es";

  const sections = db
    .prepare(
      "SELECT section_type, content FROM transcript_sections WHERE session_id = ? ORDER BY section_order"
    )
    .all(sessionId) as TranscriptSection[];

  if (sections.length === 0) {
    throw new Error("No transcript sections found");
  }

  const transcriptText = sections
    .map((s) => `[${s.section_type.toUpperCase()}]\n${s.content}`)
    .join("\n\n");

  logger.info({ sessionId, needsTitle, needsTags, outputLanguage, model: config.openai.models.metadata }, "Generating metadata");

  const prompt = buildMetadataPrompt(needsTitle, needsTags, outputLanguage);

  const completion = await openai.chat.completions.create({
    model: config.openai.models.metadata,
    messages: [
      {
        role: "system",
        content: prompt,
      },
      {
        role: "user",
        content: transcriptText,
      },
    ],
    response_format: { type: "json_object" },
    temperature: 0.3,
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) {
    throw new Error("No response from GPT");
  }

  // Security: Parse and validate with Zod
  let parsedContent: unknown;
  try {
    parsedContent = JSON.parse(content);
  } catch {
    logger.error({ content }, "Failed to parse metadata JSON");
    throw new Error("Failed to parse metadata response as JSON");
  }

  const validationResult = metadataResponseSchema.safeParse(parsedContent);
  if (!validationResult.success) {
    logger.error(
      { errors: validationResult.error.issues, content },
      "Invalid metadata response structure"
    );
    throw new Error("Invalid metadata response structure from OpenAI");
  }

  const result = validationResult.data;

  // Trim all text fields
  const summary = result.summary?.trim() ?? "";
  const keywords = (result.keywords ?? []).map((k) => k.trim()).filter(Boolean);
  const title = result.title?.trim();
  const userTags = result.userTags?.map((t) => t.trim()).filter(Boolean);

  // Build dynamic update query
  const updates: string[] = ["summary = ?", "keywords = ?", "updated_at = datetime('now')"];
  const params: (string | null)[] = [summary, JSON.stringify(keywords)];

  if (needsTitle && title) {
    updates.push("title = ?");
    params.push(title);
  }

  if (needsTags && userTags && userTags.length > 0) {
    updates.push("user_tags = ?");
    params.push(JSON.stringify(userTags));
  }

  params.push(sessionId);

  db.prepare(`
    UPDATE medical_sessions
    SET ${updates.join(", ")}
    WHERE id = ?
  `).run(...params);

  logger.info(
    {
      sessionId,
      keywordCount: keywords.length,
      generatedTitle: needsTitle ? title : null,
      generatedTagsCount: needsTags ? userTags?.length : null,
    },
    "Metadata generation completed"
  );

  // Save clinical indicators
  if (result.clinicalIndicators) {
    const ci = result.clinicalIndicators;
    const indicatorId = uuidv4();

    // Normalize treatment plan to ensure all arrays exist
    const treatmentPlan = ci.treatmentPlan
      ? {
          medicationStarted: ci.treatmentPlan.medicationStarted ?? [],
          medicationAdjusted: ci.treatmentPlan.medicationAdjusted ?? [],
          medicationDiscontinued: ci.treatmentPlan.medicationDiscontinued ?? [],
          nonPharmacologicalMeasures: ci.treatmentPlan.nonPharmacologicalMeasures ?? [],
        }
      : null;

    // Normalize follow up plan
    const followUpPlan = ci.followUpPlan
      ? {
          followUpType: ci.followUpPlan.followUpType ?? null,
          timeFrame: ci.followUpPlan.timeFrame ?? null,
          responsibleCareLevel: ci.followUpPlan.responsibleCareLevel ?? null,
        }
      : null;

    db.prepare(`
      INSERT OR REPLACE INTO clinical_indicators (
        id, session_id, urgency_level, appointment_priority,
        reason_for_visit, consulted_specialty, main_clinical_problem,
        problem_status, diagnostic_hypothesis, requested_tests,
        treatment_plan, patient_education, warning_signs, follow_up_plan,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(
      indicatorId,
      sessionId,
      ci.urgencyLevel ?? null,
      ci.appointmentPriority ?? null,
      ci.reasonForVisit?.trim() ?? null,
      ci.consultedSpecialty?.trim() ?? null,
      ci.mainClinicalProblem?.trim() ?? null,
      ci.problemStatus ?? null,
      ci.diagnosticHypothesis ? JSON.stringify(ci.diagnosticHypothesis) : null,
      ci.requestedTests ? JSON.stringify(ci.requestedTests) : null,
      treatmentPlan ? JSON.stringify(treatmentPlan) : null,
      ci.patientEducation ? JSON.stringify(ci.patientEducation) : null,
      ci.warningSigns ? JSON.stringify(ci.warningSigns) : null,
      followUpPlan ? JSON.stringify(followUpPlan) : null
    );

    logger.info(
      {
        sessionId,
        indicatorId,
        urgencyLevel: ci.urgencyLevel,
        problemStatus: ci.problemStatus,
      },
      "Clinical indicators saved"
    );
  }

  // Get token usage and calculate cost
  const inputTokens = completion.usage?.prompt_tokens ?? 0;
  const outputTokens = completion.usage?.completion_tokens ?? 0;
  const costUsd =
    (inputTokens / 1_000_000) * config.pricing.openai.inputPer1M +
    (outputTokens / 1_000_000) * config.pricing.openai.outputPer1M;

  logger.info({ sessionId, inputTokens, outputTokens, costUsd }, "Metadata cost calculated");

  return { inputTokens, outputTokens, costUsd };
}
