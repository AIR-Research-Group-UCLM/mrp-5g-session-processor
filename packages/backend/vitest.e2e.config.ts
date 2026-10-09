import { defineConfig } from "vitest/config";

// E2E_REAL_AI=1 runs the opt-in smoke suite against the real AI providers
// (OpenAI, Open WebUI, ElevenLabs) using the credentials in packages/backend/.env.
// It costs money on every run; the default suite uses a deterministic fake AI server.
const realAi = process.env.E2E_REAL_AI === "1";

export default defineConfig({
  test: {
    include: realAi ? ["e2e/real/**/*.e2e.test.ts"] : ["e2e/tests/**/*.e2e.test.ts"],
    globalSetup: ["e2e/support/global-setup.ts"],
    // One backend instance is shared by every file; run files one at a time
    // so per-user rate limits and background workers stay predictable.
    fileParallelism: false,
    testTimeout: realAi ? 20 * 60_000 : 60_000,
    hookTimeout: realAi ? 20 * 60_000 : 180_000,
  },
});
