import express from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import session from "express-session";
import { RedisStore } from "connect-redis";
import { createClient } from "redis";
import { config } from "./config/index.js";
import { errorMiddleware } from "./middleware/error.middleware.js";
import { routes } from "./routes/index.js";
import { logger } from "./config/logger.js";

export async function createApp() {
  const app = express();

  // Create Redis client for sessions (using official redis client)
  const redisClient = createClient({ url: config.redis.url });
  redisClient.on("error", (err) => logger.error({ err }, "Redis session client error"));
  await redisClient.connect();

  // Create Redis store
  const redisStore = new RedisStore({
    client: redisClient,
    prefix: "mrp:session:",
  });

  app.use(helmet());
  app.use(compression());
  app.use(
    cors({
      origin: config.corsOrigin,
      credentials: true,
    })
  );
  app.use(express.json());

  app.use(
    session({
      store: redisStore,
      secret: config.sessionSecret,
      resave: false,
      saveUninitialized: false,
      cookie: {
        secure: config.isProduction,
        httpOnly: true,
        maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
        sameSite: config.isProduction ? "strict" : "lax",
      },
    })
  );

  app.use("/api", routes);

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.use(errorMiddleware);

  return app;
}
