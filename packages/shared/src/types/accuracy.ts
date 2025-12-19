export interface SpeakerAccuracyBreakdown {
  speaker: string;
  originalCount: number;
  matchedCount: number;
  accuracy: number;
}

export interface TranscriptionAccuracy {
  overallTextSimilarity: number; // 0-100%
  wordErrorRate: number; // 0-1 (lower is better)
  speakerAccuracy: number; // 0-100%
  speakerBreakdown: SpeakerAccuracyBreakdown[];
  stats: {
    originalSegments: number;
    transcribedSegments: number;
    originalWords: number;
    transcribedWords: number;
  };
}
