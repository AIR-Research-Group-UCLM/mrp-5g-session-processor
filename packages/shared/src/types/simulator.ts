export type SimulatorSpeaker = "DOCTOR" | "PATIENT" | "SPECIALIST";

export interface SimulatorVoice {
  id: string;
  name: string;
}

export interface SimulatorVoiceSelection {
  DOCTOR: string;
  PATIENT: string;
  SPECIALIST: string;
}

export interface SimulatedSegment {
  text: string;
  speaker: SimulatorSpeaker;
}

export interface SimulatedTranscript {
  segments: SimulatedSegment[];
}

export interface CreateSimulatedSessionInput {
  context: string;
  language: string;
  voices: SimulatorVoiceSelection;
  title?: string;
  userTags?: string[];
  notes?: string;
}

export type SimulatorJobType =
  | "generate-conversation"
  | "generate-audio"
  | "concatenate-audio";

export type SimulationStatus =
  | "pending"
  | "generating-conversation"
  | "generating-audio"
  | "concatenating-audio"
  | "creating-session"
  | "completed"
  | "failed";

export interface Simulation {
  id: string;
  userId: string;
  status: SimulationStatus;
  currentStep: SimulatorJobType | null;
  totalSegments: number | null;
  completedSegments: number;
  context: string;
  language: string;
  voices: SimulatorVoiceSelection;
  title: string | null;
  userTags: string[] | null;
  notes: string | null;
  sessionId: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SimulationProgress {
  simulationId: string;
  status: SimulationStatus;
  currentStep: SimulatorJobType | null;
  totalSegments: number | null;
  completedSegments: number;
  sessionId: string | null;
  errorMessage: string | null;
}
