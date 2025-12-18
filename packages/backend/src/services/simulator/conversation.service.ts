import OpenAI from "openai";
import { config } from "../../config/index.js";
import { logger } from "../../config/logger.js";
import { getLanguageName } from "@mrp/shared";
import type { SimulatedTranscript } from "@mrp/shared";

const openai = new OpenAI({
  apiKey: config.openai.apiKey,
});

const SYSTEM_PROMPT = `You are an expert in medical consultations. Your task is to generate realistic medical conversation transcripts based on a given context.

Generate a natural, flowing conversation that MUST include ALL THREE speakers: DOCTOR, PATIENT, and SPECIALIST. The consultation should involve a specialist referral, second opinion, or multidisciplinary discussion.

Rules:
1. Generate a natural, realistic medical consultation
2. MANDATORY: Include all three speakers (DOCTOR, PATIENT, SPECIALIST) - the SPECIALIST must participate meaningfully in the conversation
3. Include all typical sections: introduction/greeting, symptoms description, examination/diagnosis discussion, specialist consultation, treatment plan, and closing
4. Use appropriate medical terminology for the language
5. Keep segments relatively short (1-3 sentences each)
6. Generate between 25-45 segments for a realistic consultation length
7. Only use speakers: DOCTOR, PATIENT, SPECIALIST
8. Make the conversation flow naturally with appropriate responses
9. Include realistic medical details based on the context provided
10. The SPECIALIST should appear at least 5-10 times throughout the conversation

Return ONLY a valid JSON object with this exact format:
{
  "segments": [
    { "text": "greeting text here", "speaker": "DOCTOR" },
    { "text": "response text here", "speaker": "PATIENT" },
    { "text": "specialist input here", "speaker": "SPECIALIST" },
    ...
  ]
}`;

export async function generateConversation(
  context: string,
  language: string
): Promise<SimulatedTranscript> {
  const languageName = getLanguageName(language);

  logger.info({ language, languageName, contextLength: context.length }, "Generating conversation");

  const userPrompt = `Generate a medical consultation conversation in ${languageName}.

Context for the consultation:
${context}

Remember to:
- Generate ALL text in ${languageName}
- Create a realistic, natural conversation
- Include proper medical terminology
- Cover introduction, symptoms, diagnosis, specialist consultation, treatment, and closing sections
- MANDATORY: Include ALL THREE speakers (DOCTOR, PATIENT, SPECIALIST) - the specialist must participate meaningfully`;

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

  return parsed;
}
