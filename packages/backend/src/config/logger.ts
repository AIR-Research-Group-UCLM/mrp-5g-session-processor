import pino, { stdTimeFunctions } from "pino";
import { config } from "./index.js";

export const logger = pino({
  level: config.isDevelopment ? "debug" : "info",
  timestamp: stdTimeFunctions.isoTime,
  transport: config.isDevelopment
    ? {
        target: "pino-pretty",
        options: {
          colorize: true,
        },
      }
    : undefined,
});
