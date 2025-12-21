import express from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import session from "express-session";
import { RedisStore } from "connect-redis";
import { createClient } from "redis";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import { config } from "./config/index.js";
import { errorMiddleware } from "./middleware/error.middleware.js";
import { routes } from "./routes/index.js";
import { logger } from "./config/logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

  // Normalize base path (remove trailing slash if present)
  const basePath = config.basePath.endsWith("/")
    ? config.basePath.slice(0, -1)
    : config.basePath;

  // Configure helmet with relaxed CSP for serving static files
  app.use(
    helmet({
      contentSecurityPolicy: config.serveStatic
        ? {
            directives: {
              defaultSrc: ["'self'"],
              scriptSrc: ["'self'", "'unsafe-inline'"],
              styleSrc: ["'self'", "'unsafe-inline'"],
              imgSrc: ["'self'", "data:", "blob:"],
              mediaSrc: ["'self'", "blob:"],
              connectSrc: ["'self'"],
            },
          }
        : undefined,
    })
  );
  app.use(compression());
  app.use(
    cors({
      origin: config.corsOrigin,
      credentials: true,
    })
  );
  app.use(express.json());

  // Cookie path should include base path for subpath deployments
  const cookiePath = basePath ? `${basePath}/` : "/";

  app.use(
    session({
      store: redisStore,
      secret: config.sessionSecret,
      resave: false,
      saveUninitialized: false,
      cookie: {
        secure: config.cookieSecure,
        httpOnly: true,
        maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
        sameSite: config.cookieSecure ? "strict" : "lax",
        path: cookiePath,
      },
    })
  );

  // Mount API routes under base path
  const apiPath = basePath ? `${basePath}/api` : "/api";
  app.use(apiPath, routes);

  // Health check at both root and base path
  const healthHandler = (_req: express.Request, res: express.Response) => {
    res.json({ status: "ok" });
  };
  app.get("/health", healthHandler);
  if (basePath) {
    app.get(`${basePath}/health`, healthHandler);
  }

  // Serve static frontend files in production
  if (config.serveStatic) {
    const staticDir = path.isAbsolute(config.staticPath)
      ? config.staticPath
      : path.join(__dirname, "..", "..", config.staticPath);

    logger.info({ staticDir, basePath }, "Serving static files");

    // Serve static files under base path
    const staticPath = basePath || "/";
    app.use(staticPath, express.static(staticDir, { maxAge: "1y", immutable: true }));

    // SPA fallback - serve index.html for all non-API routes
    const serveIndex = (_req: express.Request, res: express.Response, next: express.NextFunction) => {
      const indexPath = path.join(staticDir, "index.html");
      if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
      } else {
        next();
      }
    };

    // Handle base path root
    if (basePath) {
      app.get(basePath, serveIndex);
      app.get(`${basePath}/`, serveIndex);
    }

    // Handle all sub-routes (skip API routes)
    app.get(`${basePath}/{*splat}`, (req, res, next) => {
      if (req.path.startsWith(apiPath)) {
        return next();
      }
      serveIndex(req, res, next);
    });

    // Handle root redirect to base path
    if (basePath) {
      app.get("/", (_req, res) => {
        res.redirect(basePath + "/");
      });
    }
  }

  app.use(errorMiddleware);

  return app;
}
