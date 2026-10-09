import http from "node:http";
import type { AddressInfo } from "node:net";
import {
  FAKE_CONTEXT_SUGGESTION,
  FAKE_CONVERSATION,
  FAKE_DETECTED_LANGUAGE,
  FAKE_MEDICATION_ISSUE,
  FAKE_METADATA,
  FAKE_PATIENT_SUMMARY,
  FAKE_SEGMENTATION,
  FAKE_TOOLTIPS,
  FAKE_TRANSCRIPTION,
} from "./fake-data.js";

/**
 * Local stand-in for every AI provider the backend talks to:
 *   - OpenAI      → /openai/v1/audio/transcriptions, /openai/v1/chat/completions
 *   - Open WebUI  → /openwebui/chat/completions
 *   - ElevenLabs  → /elevenlabs/v1/text-to-speech/:voiceId
 *
 * Chat completions are routed by recognising each backend prompt, so the
 * backend runs its real pipeline against deterministic responses.
 *
 * Control endpoints let tests inspect traffic and inject failures:
 *   GET  /__control/requests          → recorded calls
 *   POST /__control/fail {kind,count} → next `count` calls of `kind` return 500
 *   POST /__control/reset             → clear recorded calls and failures
 */

export type FakeAiCallKind =
  | "transcription"
  | "language-detection"
  | "segmentation"
  | "metadata"
  | "context-suggestion"
  | "conversation"
  | "summary"
  | "tooltips"
  | "validator"
  | "tts"
  | "unknown";

export interface FakeAiCall {
  kind: FakeAiCallKind;
  path: string;
  model: string | null;
  axis: string | null;
  at: string;
}

export interface FakeAiServer {
  url: string;
  close: () => Promise<void>;
}

interface ChatBody {
  model?: string;
  messages?: Array<{ role: string; content: string }>;
}

function classifyChat(systemPrompt: string): FakeAiCallKind {
  if (systemPrompt.includes("language detection assistant")) return "language-detection";
  if (systemPrompt.includes("segment the transcript of a medical session")) return "segmentation";
  if (systemPrompt.includes("Given the segmented transcript of a medical session")) return "metadata";
  if (systemPrompt.includes("medical scenario generator")) return "context-suggestion";
  if (systemPrompt.includes("generate realistic medical conversation transcripts")) return "conversation";
  if (systemPrompt.includes("medical communication specialist")) return "summary";
  if (systemPrompt.includes("identify terms that a patient might not understand")) return "tooltips";
  if (systemPrompt.includes("clinical-safety validator")) return "validator";
  return "unknown";
}

function validatorAxis(systemPrompt: string): string | null {
  return systemPrompt.match(/on a single axis: (\w+)/)?.[1] ?? null;
}

function renameKey<T extends object>(item: T, from: string, to: string): Record<string, unknown> {
  const { [from]: value, ...rest } = item as Record<string, unknown>;
  return { ...rest, [to]: value };
}

// Real models occasionally misspell a key in a few items of a long JSON
// response (seen in production: "EndTime" in 1-2 of 232 sections). Reproduce
// that so the backend's tolerant parsing stays covered.
function segmentationWithKeyQuirks() {
  const sections = FAKE_SEGMENTATION.sections.map((section, index) => {
    if (index === 1) return renameKey(section, "endTime", "EndTime");
    if (index === 3) return renameKey(section, "startTime", "start_time");
    return section;
  });
  return { ...FAKE_SEGMENTATION, sections };
}

function metadataWithKeyQuirks() {
  return renameKey(
    { ...FAKE_METADATA, clinicalIndicators: renameKey(FAKE_METADATA.clinicalIndicators, "urgencyLevel", "UrgencyLevel") },
    "keywords",
    "Keywords"
  );
}

function conversationWithKeyQuirks() {
  const segments = FAKE_CONVERSATION.segments.map((segment, index) =>
    index === 0 ? renameKey(segment, "speaker", "Speaker") : segment
  );
  return { segments };
}

function chatContent(kind: FakeAiCallKind, axis: string | null): string {
  switch (kind) {
    case "language-detection":
      return FAKE_DETECTED_LANGUAGE;
    case "segmentation":
      return JSON.stringify(segmentationWithKeyQuirks());
    case "metadata":
      return JSON.stringify(metadataWithKeyQuirks());
    case "context-suggestion":
      return FAKE_CONTEXT_SUGGESTION;
    case "conversation":
      return JSON.stringify(conversationWithKeyQuirks());
    case "summary":
      return JSON.stringify(FAKE_PATIENT_SUMMARY);
    case "tooltips":
      return JSON.stringify(FAKE_TOOLTIPS);
    case "validator":
      return JSON.stringify({ issues: axis === "medication" ? [FAKE_MEDICATION_ISSUE] : [] });
    default:
      return "";
  }
}

function chatCompletion(model: string, content: string) {
  return {
    id: `chatcmpl-fake-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      { index: 0, message: { role: "assistant", content }, finish_reason: "stop" },
    ],
    usage: { prompt_tokens: 1000, completion_tokens: 200, total_tokens: 1200 },
  };
}

async function readBody(req: http.IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

export async function startFakeAiServer(options: { ttsAudio: Buffer }): Promise<FakeAiServer> {
  const calls: FakeAiCall[] = [];
  const pendingFailures = new Map<FakeAiCallKind, number>();

  function record(kind: FakeAiCallKind, path: string, model: string | null, axis: string | null = null) {
    calls.push({ kind, path, model, axis, at: new Date().toISOString() });
  }

  function shouldFail(kind: FakeAiCallKind): boolean {
    const remaining = pendingFailures.get(kind) ?? 0;
    if (remaining <= 0) return false;
    pendingFailures.set(kind, remaining - 1);
    return true;
  }

  const server = http.createServer(async (req, res) => {
    try {
      const path = (req.url ?? "/").split("?")[0]!;
      const body = await readBody(req);

      if (path === "/__control/requests" && req.method === "GET") {
        return sendJson(res, 200, calls);
      }
      if (path === "/__control/reset" && req.method === "POST") {
        calls.length = 0;
        pendingFailures.clear();
        return sendJson(res, 200, { ok: true });
      }
      if (path === "/__control/fail" && req.method === "POST") {
        const { kind, count } = JSON.parse(body.toString()) as { kind: FakeAiCallKind; count: number };
        pendingFailures.set(kind, count);
        return sendJson(res, 200, { ok: true });
      }

      if (path === "/openai/v1/audio/transcriptions" && req.method === "POST") {
        record("transcription", path, null);
        if (shouldFail("transcription")) {
          return sendJson(res, 500, { error: { message: "Injected transcription failure" } });
        }
        return sendJson(res, 200, FAKE_TRANSCRIPTION);
      }

      if (
        (path === "/openai/v1/chat/completions" || path === "/openwebui/chat/completions") &&
        req.method === "POST"
      ) {
        const chat = JSON.parse(body.toString()) as ChatBody;
        const systemPrompt = chat.messages?.find((m) => m.role === "system")?.content ?? "";
        const kind = classifyChat(systemPrompt);
        const axis = kind === "validator" ? validatorAxis(systemPrompt) : null;
        const model = chat.model ?? "fake-model";
        record(kind, path, model, axis);

        if (kind === "unknown") {
          return sendJson(res, 400, { error: { message: "Fake AI server: unrecognised prompt" } });
        }
        if (shouldFail(kind)) {
          return sendJson(res, 500, { error: { message: `Injected ${kind} failure` } });
        }
        return sendJson(res, 200, chatCompletion(model, chatContent(kind, axis)));
      }

      if (path.startsWith("/elevenlabs/v1/text-to-speech/") && req.method === "POST") {
        record("tts", path, null);
        if (shouldFail("tts")) {
          return sendJson(res, 500, { detail: "Injected TTS failure" });
        }
        res.writeHead(200, { "Content-Type": "audio/mpeg" });
        res.end(options.ttsAudio);
        return;
      }

      record("unknown", path, null);
      sendJson(res, 404, { error: { message: `Fake AI server: no route for ${req.method} ${path}` } });
    } catch (error) {
      sendJson(res, 500, { error: { message: error instanceof Error ? error.message : String(error) } });
    }
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
