import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  PORT: z.string().default("3001"),
  SESSION_SECRET: z.string().min(32),
  DATABASE_PATH: z.string().default("./data/mrp.db"),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),

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
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment variables:", parsed.error.format());
  process.exit(1);
}

const env = parsed.data;

export const config = {
  nodeEnv: env.NODE_ENV,
  isProduction: env.NODE_ENV === "production",
  isDevelopment: env.NODE_ENV === "development",
  port: parseInt(env.PORT, 10),
  sessionSecret: env.SESSION_SECRET,
  databasePath: env.DATABASE_PATH,
  corsOrigin: env.CORS_ORIGIN,

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
};
