import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as argon2 from "argon2";
import Database from "better-sqlite3";
import { parse as parseDotenv } from "dotenv";
import { GenericContainer, Wait, type StartedTestContainer } from "testcontainers";
import type { TestProject } from "vitest/node";
import type { E2EContext, E2EMode } from "./context.js";
import { startFakeAiServer, type FakeAiServer } from "./fake-ai-server.js";

const BACKEND_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const REPO_DIR = path.resolve(BACKEND_DIR, "../..");
const ARTIFACTS_DIR = path.join(BACKEND_DIR, "e2e/.artifacts");

const S3_BUCKET = "mrp-e2e";
const ROOT_ADMIN = { email: "admin@user.com", password: "e2e-root-admin-password" };
const FAKE_VOICES = "voice-doctor:Dr. E2E;voice-patient:Paciente E2E;voice-specialist:Especialista E2E";

function log(message: string): void {
  console.log(`[e2e] ${message}`);
}

function assertBinary(name: string): void {
  try {
    execFileSync(name, ["-version"], { stdio: "ignore" });
  } catch {
    throw new Error(`${name} must be installed and available in PATH to run the e2e suite`);
  }
}

function ffmpeg(args: string[]): void {
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args]);
}

function generateMediaFixtures(dir: string) {
  const audioMp3 = path.join(dir, "consultation.mp3");
  const videoMp4 = path.join(dir, "consultation.mp4");
  const ttsMp3 = path.join(dir, "tts.mp3");

  ffmpeg(["-f", "lavfi", "-i", "sine=frequency=440:duration=3", "-acodec", "libmp3lame", audioMp3]);
  ffmpeg([
    "-f", "lavfi", "-i", "testsrc=size=160x120:rate=10:duration=2",
    "-f", "lavfi", "-i", "sine=frequency=330:duration=2",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", videoMp4,
  ]);
  ffmpeg(["-f", "lavfi", "-i", "sine=frequency=550:duration=1", "-ar", "44100", "-ac", "2", "-acodec", "libmp3lame", ttsMp3]);

  return { audioMp3, videoMp4, ttsMp3 };
}

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    });
  });
}

async function startRedis(): Promise<StartedTestContainer> {
  return new GenericContainer("redis:8.4.0-alpine")
    .withExposedPorts(6379)
    .withWaitStrategy(Wait.forLogMessage("Ready to accept connections"))
    .start();
}

async function startGarage(): Promise<{ container: StartedTestContainer; accessKey: string; secretKey: string }> {
  // The Garage image has no shell, so wait on its log instead of probing ports from inside.
  const container = await new GenericContainer("dxflrs/garage:v2.1.0")
    .withCopyFilesToContainer([{ source: path.join(BACKEND_DIR, "e2e/support/garage.toml"), target: "/etc/garage.toml" }])
    .withExposedPorts(3900)
    .withWaitStrategy(Wait.forLogMessage("S3 API server listening"))
    .start();

  const garage = async (...args: string[]): Promise<string> => {
    const result = await container.exec(["/garage", ...args]);
    if (result.exitCode !== 0) {
      throw new Error(`garage ${args.join(" ")} failed: ${result.output}`);
    }
    return result.stdout;
  };

  const nodeId = (await garage("node", "id", "-q")).trim().split("@")[0]!;
  await garage("layout", "assign", "-z", "dc1", "-c", "1G", nodeId);
  await garage("layout", "apply", "--version", "1");
  await garage("bucket", "create", S3_BUCKET);

  const accessKey = `GK${randomBytes(12).toString("hex")}`;
  const secretKey = randomBytes(32).toString("hex");
  await garage("key", "import", "--yes", "-n", "e2e", accessKey, secretKey);
  await garage("bucket", "allow", "--read", "--write", "--owner", S3_BUCKET, "--key", accessKey);

  return { container, accessKey, secretKey };
}

function aiEnv(mode: E2EMode, fakeAiUrl: string | null): Record<string, string> {
  if (mode === "fake") {
    return {
      OPENAI_API_KEY: "sk-e2e-fake",
      OPENAI_BASE_URL: `${fakeAiUrl}/openai/v1`,
      OPEN_WEBUI_BASE_URL: `${fakeAiUrl}/openwebui`,
      OPEN_WEBUI_API_KEY: "e2e-fake",
      OPEN_WEBUI_MODEL: "fake-summary-model",
      OPEN_WEBUI_VALIDATOR_MODEL: "fake-validator-model",
      ELEVENLABS_API_KEY: "e2e-fake",
      ELEVENLABS_BASE_URL: `${fakeAiUrl}/elevenlabs`,
      SIMULATOR_VOICES: FAKE_VOICES,
    };
  }

  // Real mode: provider credentials come from the developer's backend .env,
  // and variables exported in the shell take precedence over it.
  const envPath = path.join(BACKEND_DIR, ".env");
  const dotenv = fs.existsSync(envPath) ? parseDotenv(fs.readFileSync(envPath)) : {};
  const required = ["OPENAI_API_KEY", "OPEN_WEBUI_BASE_URL", "OPEN_WEBUI_API_KEY", "ELEVENLABS_API_KEY", "SIMULATOR_VOICES"];
  const passthrough = [
    ...required,
    "OPENAI_MODEL_TRANSCRIPTION",
    "OPENAI_MODEL_SEGMENTATION",
    "OPENAI_MODEL_METADATA",
    "OPEN_WEBUI_MODEL",
    "OPEN_WEBUI_VALIDATOR_MODEL",
  ];
  const resolved = Object.fromEntries(
    passthrough
      .map((key) => [key, process.env[key] || dotenv[key]] as const)
      .filter((entry): entry is readonly [string, string] => Boolean(entry[1]))
  );

  const missing = required.filter((key) => !resolved[key]);
  if (missing.length > 0) {
    throw new Error(`E2E_REAL_AI=1 requires ${missing.join(", ")} (in ${envPath} or exported in the shell)`);
  }
  return resolved;
}

function parseVoices(raw: string): Array<{ id: string; name: string }> {
  return raw
    .split(";")
    .filter(Boolean)
    .map((entry) => {
      const [id, name] = entry.split(":");
      return { id: id?.trim() ?? "", name: name?.trim() ?? "" };
    })
    .filter((voice) => voice.id && voice.name);
}

async function waitForHealth(url: string, backend: ChildProcess, logPath: string): Promise<void> {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (backend.exitCode !== null) {
      throw new Error(`Backend exited with code ${backend.exitCode}. Log tail:\n${tail(logPath)}`);
    }
    try {
      const response = await fetch(`${url}/health`);
      if (response.ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`Backend did not become healthy in time. Log tail:\n${tail(logPath)}`);
}

function tail(file: string, lines = 40): string {
  if (!fs.existsSync(file)) return "(no log)";
  return fs.readFileSync(file, "utf-8").split("\n").slice(-lines).join("\n");
}

async function seedRootAdmin(databasePath: string): Promise<void> {
  const db = new Database(databasePath);
  try {
    db.prepare(
      "INSERT INTO users (id, email, password_hash, name, role) VALUES (?, ?, ?, ?, 'admin')"
    ).run(
      "00000000-0000-4000-8000-000000000001",
      ROOT_ADMIN.email,
      await argon2.hash(ROOT_ADMIN.password),
      "Root Admin"
    );
  } finally {
    db.close();
  }
}

export default async function setup(project: TestProject) {
  const mode: E2EMode = process.env.E2E_REAL_AI === "1" ? "real" : "fake";
  log(`mode: ${mode}`);

  assertBinary("ffmpeg");
  assertBinary("ffprobe");

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "mrp-e2e-"));
  const media = generateMediaFixtures(workDir);

  let backend: ChildProcess | null = null;
  let fakeAi: FakeAiServer | null = null;
  const containers: StartedTestContainer[] = [];
  const backendLog = path.join(workDir, "backend.log");

  const teardown = async () => {
    if (backend && backend.exitCode === null) {
      backend.kill("SIGTERM");
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 5_000);
        backend!.once("exit", () => {
          clearTimeout(timer);
          resolve(undefined);
        });
      });
      if (backend.exitCode === null) backend.kill("SIGKILL");
    }
    await fakeAi?.close();
    await Promise.all(containers.map((container) => container.stop()));

    // Keep the backend log around for debugging failed runs
    fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
    if (fs.existsSync(backendLog)) {
      fs.copyFileSync(backendLog, path.join(ARTIFACTS_DIR, "backend.log"));
    }
    if (process.env.E2E_KEEP_WORKDIR !== "1") {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  };

  try {
    log("starting Redis and Garage (S3) containers...");
    const [redis, garage] = await Promise.all([startRedis(), startGarage()]);
    containers.push(redis, garage.container);

    if (mode === "fake") {
      fakeAi = await startFakeAiServer({ ttsAudio: fs.readFileSync(media.ttsMp3) });
      log(`fake AI server listening on ${fakeAi.url}`);
    }

    const port = await getFreePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const databasePath = path.join(workDir, "mrp-e2e.db");
    const providerEnv = aiEnv(mode, fakeAi?.url ?? null);

    // Build the environment from scratch so nothing leaks in from the
    // developer's shell or .env (the backend runs with cwd = workDir).
    const env: Record<string, string> = {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? os.homedir(),
      TMPDIR: process.env.TMPDIR ?? os.tmpdir(),
      NODE_ENV: "test",
      PORT: String(port),
      SESSION_SECRET: randomBytes(32).toString("hex"),
      DATABASE_PATH: databasePath,
      CORS_ORIGIN: baseUrl,
      S3_ENDPOINT: `http://${garage.container.getHost()}:${garage.container.getMappedPort(3900)}`,
      S3_BUCKET,
      S3_ACCESS_KEY: garage.accessKey,
      S3_SECRET_KEY: garage.secretKey,
      S3_REGION: "garage",
      REDIS_URL: `redis://${redis.getHost()}:${redis.getMappedPort(6379)}`,
      SIMULATOR_PAUSE_BETWEEN_SEGMENTS_MS: "200",
      SIMULATOR_AUDIO_CONCURRENCY: "3",
      ...providerEnv,
    };

    log("starting backend...");
    const logStream = fs.openSync(backendLog, "w");
    backend = spawn(
      path.join(BACKEND_DIR, "node_modules/.bin/tsx"),
      [path.join(BACKEND_DIR, "src/index.ts")],
      { cwd: workDir, env, stdio: ["ignore", logStream, logStream] }
    );
    await waitForHealth(baseUrl, backend, backendLog);
    await seedRootAdmin(databasePath);
    log(`backend ready on ${baseUrl}`);

    const context: E2EContext = {
      mode,
      baseUrl,
      apiUrl: `${baseUrl}/api`,
      fakeAiUrl: fakeAi?.url ?? null,
      databasePath,
      rootAdmin: ROOT_ADMIN,
      fixtures: {
        audioMp3: media.audioMp3,
        videoMp4: media.videoMp4,
        reportPdf: path.join(BACKEND_DIR, "e2e/fixtures/report.pdf"),
        reportDocx: path.join(BACKEND_DIR, "e2e/fixtures/report.docx"),
        reportOdt: path.join(BACKEND_DIR, "e2e/fixtures/report.odt"),
        sampleSessionAudio: path.join(REPO_DIR, "session-sample-files/session_audio.mp3"),
      },
      simulatorVoices: parseVoices(env.SIMULATOR_VOICES ?? ""),
    };
    project.provide("e2e", context);
  } catch (error) {
    await teardown();
    throw error;
  }

  return teardown;
}
