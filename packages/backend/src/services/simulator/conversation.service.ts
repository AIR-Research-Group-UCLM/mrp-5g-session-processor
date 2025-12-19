import OpenAI from "openai";
import { config } from "../../config/index.js";
import { logger } from "../../config/logger.js";
import { getLanguageName } from "@mrp/shared";
import type { SimulatedTranscript } from "@mrp/shared";

const openai = new OpenAI({
  apiKey: config.openai.apiKey,
});

const SYSTEM_PROMPT = `You are an expert in medical consultations. Your task is to generate realistic medical conversation transcripts based on a given context.

SCENARIO: Primary care teleconsultation with remote specialist via VR glasses
- The PATIENT arrives at a primary care clinic and explains their symptoms to the DOCTOR (general practitioner)
- After initial assessment, the DOCTOR decides to consult a SPECIALIST for a second opinion
- The DOCTOR puts on VR glasses (smart glasses) that allow the SPECIALIST to see and hear everything happening in the consultation room in real-time
- The SPECIALIST joins the consultation remotely and can interact with both the DOCTOR and PATIENT
- The three participants discuss the case together until the consultation is resolved
- The SPECIALIST can request the DOCTOR to perform specific examinations, ask the PATIENT questions directly, and provide expert guidance

Conversation flow:
1. INTRODUCTION: Patient arrives, greets the doctor, initial pleasantries
2. SYMPTOMS: Patient explains their symptoms and concerns to the doctor
3. INITIAL ASSESSMENT: Doctor asks follow-up questions and performs initial examination
4. SPECIALIST CONNECTION: Doctor decides to consult specialist, puts on VR glasses, specialist joins
5. COLLABORATIVE DIAGNOSIS: Three-way conversation where specialist can see/hear everything, asks questions, requests examinations
6. TREATMENT PLAN: Specialist and doctor discuss and agree on treatment, explain to patient
7. CLOSING: Summary, follow-up instructions, farewell

Rules:
1. Generate a natural, realistic medical consultation following the above flow
2. MANDATORY: Include all three speakers (DOCTOR, PATIENT, SPECIALIST) - the SPECIALIST must participate meaningfully after being connected
3. The SPECIALIST should NOT appear until the connection moment (after initial patient-doctor interaction)
4. Include a clear moment where the DOCTOR announces they will connect with a specialist via the VR glasses
5. The SPECIALIST should acknowledge joining remotely and being able to see/hear the consultation
6. Use appropriate medical terminology for the language
7. Keep segments SHORT (1-2 sentences each, around 15-30 words per segment)
8. TARGET DURATION: Generate 35-45 segments to create an 8-10 minute conversation (aim for ~1000-1200 total words)
9. Only use speakers: DOCTOR, PATIENT, SPECIALIST
10. Make the conversation flow naturally with appropriate responses
11. Include realistic medical details based on the context provided
12. The SPECIALIST should appear at least 8-12 times throughout the conversation after joining
13. Avoid overly long monologues - keep the dialogue dynamic and interactive

Return ONLY a valid JSON object with this exact format:
{
  "segments": [
    { "text": "greeting text here", "speaker": "DOCTOR" },
    { "text": "response text here", "speaker": "PATIENT" },
    { "text": "specialist input here", "speaker": "SPECIALIST" },
    ...
  ]
}`;

export interface ConversationCostResult {
  transcript: SimulatedTranscript;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export async function generateConversation(
  context: string,
  language: string
): Promise<ConversationCostResult> {
  const languageName = getLanguageName(language);

  logger.info({ language, languageName, contextLength: context.length }, "Generating conversation");

  const userPrompt = `Generate a medical consultation conversation in ${languageName}.

Context for the consultation:
${context}

Remember to:
- Generate ALL text in ${languageName}
- Create a realistic, natural conversation following the primary care teleconsultation scenario
- The patient arrives at primary care, explains symptoms to the doctor
- The doctor performs initial assessment, then decides to connect with a specialist via VR glasses
- The specialist joins remotely (can see and hear everything through the doctor's VR glasses) and participates in the diagnosis
- Include a clear moment where the doctor puts on the VR glasses and the specialist acknowledges joining
- The three participants collaborate until the consultation is resolved
- Include proper medical terminology
- MANDATORY: Include ALL THREE speakers (DOCTOR, PATIENT, SPECIALIST) - the specialist must NOT appear until the connection moment
- TARGET: Generate 35-45 segments with 15-30 words each, for a total of 8-10 minutes of audio`;

  const completion = await openai.chat.completions.create({
    model: config.openai.models.segmentation,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
    response_format: { type: "json_object" },
    temperature: 0.7,
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) {
    throw new Error("No content received from OpenAI");
  }

  let parsed: SimulatedTranscript;
  try {
    parsed = JSON.parse(content) as SimulatedTranscript;
  } catch {
    logger.error({ content }, "Failed to parse conversation JSON");
    throw new Error("Failed to parse conversation response as JSON");
  }

  if (!parsed.segments || !Array.isArray(parsed.segments)) {
    throw new Error("Invalid conversation format: missing segments array");
  }

  // Validate segments
  const speakersFound = new Set<string>();
  for (const segment of parsed.segments) {
    if (!segment.text || !segment.speaker) {
      throw new Error("Invalid segment: missing text or speaker");
    }
    if (!["DOCTOR", "PATIENT", "SPECIALIST"].includes(segment.speaker)) {
      throw new Error(`Invalid speaker: ${segment.speaker}`);
    }
    speakersFound.add(segment.speaker);
  }

  // Ensure all three speakers are present
  const requiredSpeakers = ["DOCTOR", "PATIENT", "SPECIALIST"];
  for (const speaker of requiredSpeakers) {
    if (!speakersFound.has(speaker)) {
      throw new Error(`Missing required speaker: ${speaker}. All three speakers (DOCTOR, PATIENT, SPECIALIST) must be present.`);
    }
  }

  logger.info(
    { segmentCount: parsed.segments.length, language, speakers: Array.from(speakersFound) },
    "Conversation generated successfully"
  );

  // Get token usage and calculate cost
  const inputTokens = completion.usage?.prompt_tokens ?? 0;
  const outputTokens = completion.usage?.completion_tokens ?? 0;
  const costUsd =
    (inputTokens / 1_000_000) * config.pricing.openai.inputPer1M +
    (outputTokens / 1_000_000) * config.pricing.openai.outputPer1M;

  logger.info({ language, inputTokens, outputTokens, costUsd }, "Conversation cost calculated");

  return { transcript: parsed, inputTokens, outputTokens, costUsd };
}
