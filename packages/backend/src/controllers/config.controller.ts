import type { RequestHandler } from "express";
import type { AppConfig } from "@mrp/shared";
import { config } from "../config/index.js";
import { logger } from "../config/logger.js";

/**
 * Is the local WhisperX sidecar actually usable right now? It must be enabled AND
 * reachable — i.e. the `whisperx` compose profile is up. The UI offers the local
 * option only when this returns true, so users can't pick an engine whose service
 * isn't running.
 */
async function isWhisperxAvailable(): Promise<boolean> {
  const wx = config.transcription.whisperx;
  if (!wx.enabled) return false;

  try {
    const res = await fetch(`${wx.serviceUrl}/health`, {
      signal: AbortSignal.timeout(2_000),
    });
    return res.ok;
  } catch (error) {
    logger.debug({ error, serviceUrl: wx.serviceUrl }, "WhisperX sidecar health probe failed");
    return false;
  }
}

/**
 * Exposes the runtime capabilities the frontend needs (e.g. whether local
 * WhisperX transcription is available, and on which device). No secrets here.
 */
const getConfig: RequestHandler = async (_req, res, next) => {
  try {
    const appConfig: AppConfig = {
      transcription: {
        defaultEngine: config.transcription.defaultEngine,
        whisperxEnabled: config.transcription.whisperx.enabled,
        whisperxAvailable: await isWhisperxAvailable(),
        whisperxDevice: config.transcription.whisperx.device as "cpu" | "cuda",
      },
    };

    res.json({ success: true, data: appConfig });
  } catch (error) {
    next(error);
  }
};

export const configController = {
  getConfig,
};
