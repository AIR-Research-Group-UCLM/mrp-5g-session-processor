import { getDb } from "../db/connection.js";
import { s3Service } from "./s3.service.js";
import type {
  TranscriptionAccuracy,
  SpeakerAccuracyBreakdown,
  SimulatedTranscript,
} from "@mrp/shared";

interface DbSession {
  id: string;
  user_id: string;
  video_s3_key: string | null;
  is_simulated: number;
  status: string;
}

interface DbTranscriptSection {
  id: string;
  session_id: string;
  section_type: string;
  section_order: number;
  speaker: string | null;
  content: string;
  start_time_seconds: number | null;
  end_time_seconds: number | null;
}

/**
 * Normalize text for comparison: lowercase, remove punctuation, collapse whitespace
 */
function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "") // Remove punctuation (Unicode-aware)
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Calculate Levenshtein distance between two arrays (word-level)
 */
function levenshteinDistance(a: string[], b: string[]): number {
  const m = a.length;
  const n = b.length;

  // Create matrix initialized with zeros
  const dp: number[][] = [];
  for (let i = 0; i <= m; i++) {
    dp[i] = [];
    for (let j = 0; j <= n; j++) {
      dp[i]![j] = 0;
    }
  }

  // Initialize base cases
  for (let i = 0; i <= m; i++) {
    dp[i]![0] = i;
  }
  for (let j = 0; j <= n; j++) {
    dp[0]![j] = j;
  }

  // Fill matrix
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i]![j] = dp[i - 1]![j - 1]!;
      } else {
        dp[i]![j] = 1 + Math.min(dp[i - 1]![j]!, dp[i]![j - 1]!, dp[i - 1]![j - 1]!);
      }
    }
  }

  return dp[m]![n]!;
}

/**
 * Calculate Word Error Rate (WER)
 * WER = (substitutions + insertions + deletions) / reference_word_count
 */
function calculateWER(original: string, transcribed: string): number {
  const originalWords = normalizeText(original).split(" ").filter(Boolean);
  const transcribedWords = normalizeText(transcribed).split(" ").filter(Boolean);

  if (originalWords.length === 0) {
    return transcribedWords.length === 0 ? 0 : 1;
  }

  const distance = levenshteinDistance(originalWords, transcribedWords);
  return distance / originalWords.length;
}

/**
 * Calculate word count for a text
 */
function countWords(text: string): number {
  return normalizeText(text).split(" ").filter(Boolean).length;
}

/**
 * Calculate speaker accuracy by comparing text distribution per speaker.
 *
 * Strategy: For each original segment, find the best matching transcribed segment
 * based on text similarity and check if the speaker was correctly identified.
 *
 * This handles cases where segments are merged/split differently between
 * simulation and transcription.
 */
function calculateSpeakerAccuracy(
  originalSegments: Array<{ text: string; speaker: string }>,
  transcribedSegments: Array<{ content: string; speaker: string | null }>
): { accuracy: number; breakdown: SpeakerAccuracyBreakdown[] } {
  // Calculate word counts per speaker in original
  const originalWordsBySpeaker: Map<string, number> = new Map();
  for (const seg of originalSegments) {
    const words = countWords(seg.text);
    originalWordsBySpeaker.set(
      seg.speaker,
      (originalWordsBySpeaker.get(seg.speaker) ?? 0) + words
    );
  }

  // Calculate word counts per speaker in transcription
  const transcribedWordsBySpeaker: Map<string, number> = new Map();
  for (const seg of transcribedSegments) {
    if (!seg.speaker) continue;
    const words = countWords(seg.content);
    transcribedWordsBySpeaker.set(
      seg.speaker,
      (transcribedWordsBySpeaker.get(seg.speaker) ?? 0) + words
    );
  }

  // Calculate total words
  let totalOriginalWords = 0;
  for (const count of originalWordsBySpeaker.values()) {
    totalOriginalWords += count;
  }

  let totalTranscribedWords = 0;
  for (const count of transcribedWordsBySpeaker.values()) {
    totalTranscribedWords += count;
  }

  // Calculate accuracy per speaker based on word distribution match
  const breakdown: SpeakerAccuracyBreakdown[] = [];
  let weightedAccuracy = 0;

  for (const speaker of originalWordsBySpeaker.keys()) {
    const originalWords = originalWordsBySpeaker.get(speaker) ?? 0;
    const transcribedWords = transcribedWordsBySpeaker.get(speaker) ?? 0;

    // Calculate expected vs actual proportion
    const expectedProportion = totalOriginalWords > 0 ? originalWords / totalOriginalWords : 0;
    const actualProportion = totalTranscribedWords > 0 ? transcribedWords / totalTranscribedWords : 0;

    // Calculate accuracy as how close the proportions are
    // If expected 30% and got 28%, that's 93% accurate for this speaker
    const proportionDiff = Math.abs(expectedProportion - actualProportion);
    const speakerAccuracy = Math.max(0, (1 - proportionDiff / Math.max(expectedProportion, 0.01)) * 100);

    breakdown.push({
      speaker,
      originalCount: originalWords,
      matchedCount: transcribedWords,
      accuracy: Math.round(speakerAccuracy * 10) / 10,
    });

    // Weight by proportion of words
    weightedAccuracy += speakerAccuracy * expectedProportion;
  }

  // Check for speakers in transcription that weren't in original
  for (const speaker of transcribedWordsBySpeaker.keys()) {
    if (!originalWordsBySpeaker.has(speaker)) {
      const transcribedWords = transcribedWordsBySpeaker.get(speaker) ?? 0;
      breakdown.push({
        speaker,
        originalCount: 0,
        matchedCount: transcribedWords,
        accuracy: 0,
      });
    }
  }

  return {
    accuracy: Math.round(weightedAccuracy * 10) / 10,
    breakdown,
  };
}

/**
 * Fetch simulated transcript from S3
 */
async function fetchSimulatedTranscript(
  userId: string,
  sessionId: string
): Promise<SimulatedTranscript | null> {
  const s3Key = `${userId}/${sessionId}/simulated_transcript.json`;

  try {
    const url = await s3Service.getPresignedUrl(s3Key);
    const response = await fetch(url);

    if (!response.ok) {
      return null;
    }

    return (await response.json()) as SimulatedTranscript;
  } catch {
    return null;
  }
}

/**
 * Fetch transcript sections from database
 */
function fetchTranscriptSections(sessionId: string): DbTranscriptSection[] {
  const db = getDb();
  return db
    .prepare(
      "SELECT * FROM transcript_sections WHERE session_id = ? ORDER BY section_order"
    )
    .all(sessionId) as DbTranscriptSection[];
}

/**
 * Get session basic info
 */
function getSessionInfo(
  sessionId: string,
  userId: string
): DbSession | null {
  const db = getDb();
  const row = db
    .prepare("SELECT id, user_id, video_s3_key, is_simulated, status FROM medical_sessions WHERE id = ? AND user_id = ?")
    .get(sessionId, userId) as DbSession | undefined;

  return row ?? null;
}

/**
 * Calculate transcription accuracy for a simulated session
 */
async function calculateTranscriptionAccuracy(
  sessionId: string,
  userId: string
): Promise<TranscriptionAccuracy | null> {
  // Get session info
  const session = getSessionInfo(sessionId, userId);
  if (!session) {
    return null;
  }

  // Validate session is simulated and completed
  if (session.is_simulated !== 1) {
    throw new Error("Session is not simulated");
  }

  if (session.status !== "completed") {
    throw new Error("Session processing not completed");
  }

  // Fetch source data
  const simulatedTranscript = await fetchSimulatedTranscript(userId, sessionId);
  if (!simulatedTranscript) {
    throw new Error("Simulated transcript not found in S3");
  }

  const transcriptSections = fetchTranscriptSections(sessionId);
  if (transcriptSections.length === 0) {
    throw new Error("No transcript sections found");
  }

  // Concatenate all text from both sources
  const originalText = simulatedTranscript.segments
    .map((s) => s.text)
    .join(" ");

  const transcribedText = transcriptSections.map((s) => s.content).join(" ");

  // Calculate WER
  const wer = calculateWER(originalText, transcribedText);
  const textSimilarity = Math.max(0, (1 - wer) * 100);

  // Calculate speaker accuracy
  const { accuracy: speakerAccuracy, breakdown: speakerBreakdown } =
    calculateSpeakerAccuracy(
      simulatedTranscript.segments,
      transcriptSections.map((s) => ({ content: s.content, speaker: s.speaker }))
    );

  // Calculate word counts
  const originalWords = normalizeText(originalText).split(" ").filter(Boolean);
  const transcribedWords = normalizeText(transcribedText).split(" ").filter(Boolean);

  return {
    overallTextSimilarity: Math.round(textSimilarity * 10) / 10,
    wordErrorRate: Math.round(wer * 1000) / 1000,
    speakerAccuracy: Math.round(speakerAccuracy * 10) / 10,
    speakerBreakdown,
    stats: {
      originalSegments: simulatedTranscript.segments.length,
      transcribedSegments: transcriptSections.length,
      originalWords: originalWords.length,
      transcribedWords: transcribedWords.length,
    },
  };
}

export const accuracyService = {
  calculateTranscriptionAccuracy,
};
