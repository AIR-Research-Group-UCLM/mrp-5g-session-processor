import type { TranscriptionEngine } from "./session.js";

/** Runtime capabilities/config the frontend needs to render correctly. */
export interface AppConfig {
  transcription: {
    /** Engine used when a session is created without an explicit choice. */
    defaultEngine: TranscriptionEngine;
    /** Whether the operator turned the local WhisperX engine on (WHISPERX_ENABLED). */
    whisperxEnabled: boolean;
    /** Whether the WhisperX sidecar is actually reachable right now (enabled AND its
     *  /health responds). The UI offers the local option only when this is true. */
    whisperxAvailable: boolean;
    /** Hardware the local WhisperX sidecar runs on. */
    whisperxDevice: "cpu" | "cuda";
  };
}
