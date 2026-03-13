import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.string().default("3001"),
  SESSION_SECRET: z.string().min(32),
  DATABASE_PATH: z.string().default("./data/mrp.db"),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),
  BASE_PATH: z.string().default(""),
  SERVE_STATIC: z.string().default("false"),
  STATIC_PATH: z.string().default("./public"),
  COOKIE_SECURE: z.string().default("auto"),

  // S3 (Garage)
  S3_ENDPOINT: z.string(),
  S3_BUCKET: z.string(),
  S3_ACCESS_KEY: z.string(),
  S3_SECRET_KEY: z.string(),
  S3_REGION: z.string().default("garage"),

  // Redis
  REDIS_URL: z.string().default("redis://localhost:6379"),

  // OpenAI
  OPENAI_API_KEY: z.string(),
  OPENAI_MODEL_TRANSCRIPTION: z.string().default("gpt-4o-transcribe-diarize"),
  OPENAI_MODEL_SEGMENTATION: z.string().default("gpt-5.1"),
  OPENAI_MODEL_METADATA: z.string().default("gpt-5.1"),

  // Open WebUI (optional - consultation summary feature)
  OPEN_WEBUI_BASE_URL: z.string().optional(),
  OPEN_WEBUI_API_KEY: z.string().optional(),
  OPEN_WEBUI_MODEL: z.string().default("gemma3:12b"),

  // Consultation Summary
  CONSULTATION_SUMMARY_SHARE_EXPIRY_HOURS: z.coerce.number().default(168),

  // ElevenLabs
  ELEVENLABS_API_KEY: z.string(),

  // Simulator
  // Format: ID#Name;ID#Name;... (e.g., "abc123#Dr. Smith;def456#Patient Voice;ghi789#Specialist")
  SIMULATOR_VOICES: z.string(),
  SIMULATOR_PAUSE_BETWEEN_SEGMENTS_MS: z.coerce.number().default(1000),
  SIMULATOR_AUDIO_CONCURRENCY: z.coerce.number().default(3),

  // Pricing (USD)
  OPENAI_PRICE_TRANSCRIPTION_PER_MINUTE: z.coerce.number().default(0.006),
  OPENAI_PRICE_INPUT_PER_1M: z.coerce.number().default(1.25),
  OPENAI_PRICE_OUTPUT_PER_1M: z.coerce.number().default(10.0),
  ELEVENLABS_PRICE_PER_1K_CHARS: z.coerce.number().default(0.3),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment variables:", parsed.error.format());
  process.exit(1);
}

const env = parsed.data;

// Security: Validate CORS origin in production to prevent overly permissive settings
if (env.NODE_ENV === "production") {
  if (env.CORS_ORIGIN === "*" || env.CORS_ORIGIN.includes("*")) {
    console.error(
      "Security Error: CORS_ORIGIN cannot contain wildcards in production. " +
      "Please specify explicit allowed origins."
    );
    process.exit(1);
  }
  // Warn if CORS allows localhost in production
  if (env.CORS_ORIGIN.includes("localhost") || env.CORS_ORIGIN.includes("127.0.0.1")) {
    console.warn(
      "Security Warning: CORS_ORIGIN includes localhost addresses in production. " +
      "This may be a security risk."
    );
  }
}

export const config = {
  nodeEnv: env.NODE_ENV,
  isProduction: env.NODE_ENV === "production",
  isDevelopment: env.NODE_ENV === "development",
  port: parseInt(env.PORT, 10),
  sessionSecret: env.SESSION_SECRET,
  databasePath: env.DATABASE_PATH,
  corsOrigin: env.CORS_ORIGIN,
  basePath: env.BASE_PATH,
  serveStatic: env.SERVE_STATIC === "true",
  staticPath: env.STATIC_PATH,
  cookieSecure: env.COOKIE_SECURE === "auto" ? env.NODE_ENV === "production" : env.COOKIE_SECURE === "true",

  s3: {
    endpoint: env.S3_ENDPOINT,
    bucket: env.S3_BUCKET,
    accessKey: env.S3_ACCESS_KEY,
    secretKey: env.S3_SECRET_KEY,
    region: env.S3_REGION,
  },

  redis: {
    url: env.REDIS_URL,
  },

  openai: {
    apiKey: env.OPENAI_API_KEY,
    models: {
      transcription: env.OPENAI_MODEL_TRANSCRIPTION,
      segmentation: env.OPENAI_MODEL_SEGMENTATION,
      metadata: env.OPENAI_MODEL_METADATA,
    },
  },

  openWebUi: {
    baseUrl: env.OPEN_WEBUI_BASE_URL ?? null,
    apiKey: env.OPEN_WEBUI_API_KEY ?? null,
    model: env.OPEN_WEBUI_MODEL,
  },

  consultationSummary: {
    shareExpiryHours: env.CONSULTATION_SUMMARY_SHARE_EXPIRY_HOURS,
  },

  elevenlabs: {
    apiKey: env.ELEVENLABS_API_KEY,
  },

  simulator: {
    voices: env.SIMULATOR_VOICES.split(";")
      .filter(Boolean)
      .map((entry) => {
        const [id, name] = entry.split(":");
        return { id: id?.trim() ?? "", name: name?.trim() ?? "" };
      })
      .filter((v) => v.id && v.name),
    pauseBetweenSegmentsMs: env.SIMULATOR_PAUSE_BETWEEN_SEGMENTS_MS,
    audioConcurrency: env.SIMULATOR_AUDIO_CONCURRENCY,
  },

  pricing: {
    openai: {
      transcriptionPerMinute: env.OPENAI_PRICE_TRANSCRIPTION_PER_MINUTE,
      inputPer1M: env.OPENAI_PRICE_INPUT_PER_1M,
      outputPer1M: env.OPENAI_PRICE_OUTPUT_PER_1M,
    },
    elevenlabs: {
      per1kChars: env.ELEVENLABS_PRICE_PER_1K_CHARS,
    },
  },
};
