import type { SectionType } from "@mrp/shared";
import { getLanguageName } from "@mrp/shared";
import OpenAI from "openai";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import { config } from "../../config/index.js";
import { logger } from "../../config/logger.js";
import { getDb } from "../../db/connection.js";
import { withRetry } from "../../utils/retry.js";
import { s3Service } from "../s3.service.js";

// Section descriptions in English for the prompt
const SECTION_DESCRIPTIONS: Record<SectionType, string> = {
  introduction: "Initial greeting and introduction between healthcare professional and patient",
  symptoms: "Patient describes symptoms, discomfort or reason for consultation",
  diagnosis: "Healthcare professional evaluates and communicates diagnosis or possible diagnoses",
  treatment: "Treatment instructions, medication, lifestyle changes or recommendations",
  closing: "Consultation closing, next steps and farewell",
};

const SECTION_TYPES_LIST: SectionType[] = ["introduction", "symptoms", "diagnosis", "treatment", "closing"];

const openai = new OpenAI({
  apiKey: config.openai.apiKey,
});

interface TranscriptData {
  text: string;
  segments: Array<{
    start: number;
    end: number;
    text: string;
    speaker?: string;
  }>;
}

// Security: Zod schemas for validating OpenAI JSON responses
const segmentedSectionSchema = z.object({
  sectionType: z.enum(["introduction", "symptoms", "diagnosis", "treatment", "closing"]),
  speaker: z.string(),
  content: z.string(),
  startTime: z.number(),
  endTime: z.number(),
});

const sectionSummarySchema = z.object({
  sectionType: z.enum(["introduction", "symptoms", "diagnosis", "treatment", "closing"]),
  summary: z.string(),
});

const segmentationResponseSchema = z.object({
  sections: z.array(segmentedSectionSchema),
  sectionSummaries: z.array(sectionSummarySchema).optional(),
});

export interface SegmentationCostResult {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

// Build prompt with section descriptions
function buildSegmentationPrompt(outputLanguage: string): string {
  const sectionList = SECTION_TYPES_LIST.map((type) => `- ${type}: ${SECTION_DESCRIPTIONS[type]}`).join("\n");
  const languageName = getLanguageName(outputLanguage);

  return `You are an expert in medical consultation analysis. Your task is to segment the transcript of a medical session into the following sections:

${sectionList}

Analyze the transcript and return a JSON with the following format:
{
  "sections": [
    {
      "sectionType": "introduction" | "symptoms" | "diagnosis" | "treatment" | "closing",
      "speaker": "DOCTOR" | "PATIENT" | "SPECIALIST" | "OTHER",
      "content": "Speech turn text",
      "startTime": 0.0,
      "endTime": 10.5
    }
  ],
  "sectionSummaries": [
    {
      "sectionType": "introduction",
      "summary": "Brief summary of this section (1-2 sentences)"
    }
  ]
}

Rules:
1. IMPORTANT: Generate ONE section per speech turn, preserving who says each phrase
2. Speakers in the original transcript (A, B, C, etc.) must be re-labeled semantically as "DOCTOR", "PATIENT", "SPECIALIST" or "OTHER"
3. Identify who is who based on context (e.g.: who greets as "doctor" is the patient, who asks medical questions is the doctor)
4. Each section must have one of the specified types (introduction, symptoms, etc.)
5. Times must match the timestamps from the original transcript
6. Content must be the exact text from the transcript
7. Maintain chronological order of sections
8. IMPORTANT: Section type must follow the logical order of a medical consultation: introduction → symptoms → diagnosis → treatment → closing. Once a section advances to a later type, it CANNOT go back to an earlier type. For example, if you already classified a turn as "diagnosis", the following turns can only be "diagnosis", "treatment" or "closing", never "symptoms" or "introduction".
9. For sectionSummaries, generate ONE summary per section type that exists (grouping all speech turns of the same type)
10. Summaries should be concise and capture the key points of each section

CRITICAL: Generate all summaries in ${languageName}.`;
}

export async function processSegmentation(sessionId: string): Promise<SegmentationCostResult> {
  const db = getDb();

  const session = db
    .prepare("SELECT video_s3_key, language FROM medical_sessions WHERE id = ?")
    .get(sessionId) as { video_s3_key: string; language: string | null } | undefined;

  if (!session?.video_s3_key) {
    throw new Error("Session not found");
  }

  const outputLanguage = session.language ?? "es";
  const transcriptS3Key = session.video_s3_key.replace(/\.[^.]+$/, "_transcript.json");
  const transcriptUrl = await s3Service.getPresignedUrl(transcriptS3Key);

  const response = await fetch(transcriptUrl);
  const transcriptData = (await response.json()) as TranscriptData;

  logger.info({ sessionId, model: config.openai.models.segmentation, outputLanguage }, "Segmenting transcript");

  // Timeout: 10 minutes, retries: 3 attempts
  const { result, completion } = await withRetry(
    async () => {
      const completion = await openai.chat.completions.create({
        model: config.openai.models.segmentation,
        messages: [
          {
            role: "system",
            content: buildSegmentationPrompt(outputLanguage),
          },
          {
            role: "user",
            content: `Transcript to segment:\n\n${transcriptData.text}\n\nSegments with timestamps:\n${JSON.stringify(transcriptData.segments, null, 2)}`,
          },
        ],
        response_format: { type: "json_object" },
        temperature: 0.3,
      });

      const content = completion.choices[0]?.message?.content;
      if (!content) {
        throw new Error("No response from GPT");
      }

      // Security: Validate OpenAI response structure with Zod
      let parsedContent: unknown;
      try {
        parsedContent = JSON.parse(content);
      } catch {
        logger.error({ content }, "Failed to parse segmentation JSON");
        throw new Error("Failed to parse segmentation response as JSON");
      }

      const validationResult = segmentationResponseSchema.safeParse(parsedContent);
      if (!validationResult.success) {
        logger.error(
          { errors: validationResult.error.issues, content },
          "Invalid segmentation response structure"
        );
        throw new Error("Invalid segmentation response structure from OpenAI");
      }

      return { result: validationResult.data, completion };
    },
    {
      operationName: "segmentation",
      sessionId,
    }
  );

  const insertSectionStmt = db.prepare(`
    INSERT INTO transcript_sections (
      id, session_id, section_type, section_order, speaker, content,
      start_time_seconds, end_time_seconds
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertSummaryStmt = db.prepare(`
    INSERT INTO section_summaries (id, session_id, section_type, summary)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(session_id, section_type) DO UPDATE SET summary = excluded.summary
  `);

  const insertAll = db.transaction(() => {
    // Insert sections
    for (let i = 0; i < result.sections.length; i++) {
      const section = result.sections[i]!;
      insertSectionStmt.run(
        uuidv4(),
        sessionId,
        section.sectionType,
        i,
        section.speaker,
        section.content,
        section.startTime,
        section.endTime
      );
    }

    // Insert section summaries
    for (const summary of result.sectionSummaries ?? []) {
      insertSummaryStmt.run(uuidv4(), sessionId, summary.sectionType, summary.summary);
    }
  });

  insertAll();

  // Get token usage and calculate cost
  const inputTokens = completion.usage?.prompt_tokens ?? 0;
  const outputTokens = completion.usage?.completion_tokens ?? 0;
  const costUsd =
    (inputTokens / 1_000_000) * config.pricing.openai.inputPer1M +
    (outputTokens / 1_000_000) * config.pricing.openai.outputPer1M;

  logger.info(
    {
      sessionId,
      sectionCount: result.sections.length,
      summaryCount: result.sectionSummaries?.length ?? 0,
      inputTokens,
      outputTokens,
      costUsd,
    },
    "Segmentation completed"
  );

  return { inputTokens, outputTokens, costUsd };
}
