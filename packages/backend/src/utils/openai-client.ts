import OpenAI, { type ClientOptions } from "openai";
import { Agent } from "undici";
import { config } from "../config/index.js";

// Node's fetch aborts a request after 300 s without response headers (undici's default
// headersTimeout). The OpenAI SDK reports that as "Request timed out." and retries it, so long
// non-streaming calls (e.g. diarised transcription of 15+ minute recordings) failed after
// 3 x 5 minutes regardless of the client timeout. Align undici's timeouts with OPENAI_TIMEOUT_MS.
const dispatcher = new Agent({
  headersTimeout: config.openai.timeoutMs,
  bodyTimeout: config.openai.timeoutMs,
});

export function createPipelineOpenAIClient(): OpenAI {
  return new OpenAI({
    apiKey: config.openai.apiKey,
    timeout: config.openai.timeoutMs,
    // undici's Dispatcher type differs from the one bundled with @types/node; the runtime is compatible.
    fetchOptions: { dispatcher } as unknown as ClientOptions["fetchOptions"],
  });
}
