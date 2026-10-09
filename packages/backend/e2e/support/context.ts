export type E2EMode = "fake" | "real";

/** Values shared by the global setup with every test file via `inject("e2e")`. */
export interface E2EContext {
  mode: E2EMode;
  baseUrl: string;
  apiUrl: string;
  /** Fake AI server URL (null when running against the real AI providers) */
  fakeAiUrl: string | null;
  databasePath: string;
  rootAdmin: { email: string; password: string };
  fixtures: {
    audioMp3: string;
    videoMp4: string;
    reportPdf: string;
    reportDocx: string;
    reportOdt: string;
    sampleSessionAudio: string;
  };
  simulatorVoices: Array<{ id: string; name: string }>;
}

declare module "vitest" {
  export interface ProvidedContext {
    e2e: E2EContext;
  }
}
