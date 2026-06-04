# WhisperX transcription sidecar

A fully local, drop-in alternative to the cloud `gpt-4o-transcribe-diarize`
endpoint used by the MRP 5G session processor. It runs faster-whisper ASR →
wav2vec2 word alignment → pyannote diarisation and returns the **same JSON
shape** the Node backend already consumes, so nothing downstream changes.

It ships as a **Docker service** so the team never manages a Python venv: it's
just another container alongside Redis/Garage, started on demand via a compose
profile. The app's `pnpm dev` / `pnpm build` workflow is unchanged.

## Lifecycle (single instance, lazy + warm + idle-release)

- One model in memory at most, behind an internal **single-worker queue**.
- **Cold start**: model loads on the first queued job.
- **Keep warm**: it stays resident for `WHISPERX_IDLE_TTL_SECONDS` after the last job.
- **Release**: once idle past the TTL it is unloaded and GPU/RAM is freed.

This is what lets it share a GPU with `gpt-oss:20b`: WhisperX only holds VRAM
while there is work (plus the warm window), then lets go.

## Enabling local transcription

Local transcription is **off by default** — the app uses cloud transcription and
no part of this service runs. To turn it on:

1. Configure the **sidecar** in its own env file (the compose service reads it):
   ```bash
   cp whisperx-service/.env.example whisperx-service/.env
   # then edit whisperx-service/.env:
   #   WHISPERX_HF_TOKEN=hf_xxx   # gated pyannote token (accept its terms on HF first)
   #   WHISPERX_MODEL=small       # tiny/base/small are much faster on CPU than large-v3
   ```
2. Start the sidecar (also brings up Redis/Garage):
   ```bash
   pnpm docker:whisperx
   # = docker compose -f docker/docker-compose.yml --profile whisperx up -d
   ```
3. Configure the **backend** in `packages/backend/.env`:
   ```env
   WHISPERX_ENABLED=true
   # WHISPERX_DEVICE=cpu                 # cpu (default) | cuda — forwarded to the sidecar per job
   # TRANSCRIPTION_ENGINE_DEFAULT=whisperx  # optional: make local the default
   ```
4. Start the app as usual (`pnpm dev`). The New Session page now shows a
   **Local — WhisperX** option (only while the sidecar's `/health` is reachable).

**Which var goes where:** sidecar-only settings — `WHISPERX_HF_TOKEN`, `WHISPERX_MODEL`,
`WHISPERX_IDLE_TTL_SECONDS`, `WHISPERX_MIN/MAX_SPEAKERS` — live in `whisperx-service/.env`
(read by the container). Backend settings — `WHISPERX_ENABLED`, `WHISPERX_DEVICE`,
`WHISPERX_SERVICE_URL`, `TRANSCRIPTION_ENGINE_DEFAULT` — live in `packages/backend/.env`
(read by the Node app). They're separate processes, hence separate files.

### GPU

The image's torch build is CUDA-capable. For GPU: install the NVIDIA Container
Toolkit, set `WHISPERX_DEVICE=cuda`, and uncomment the `deploy.resources` block in
`docker/docker-compose.yml` (dev) / `docker-compose.prod.yml` (prod).

## Health & smoke test

```bash
curl -s localhost:8001/health | jq
# { "modelLoaded": false, "device": "cpu", "idleSeconds": ..., "queueDepth": 0, "busy": false, ... }

# submit a job, then poll
JID=$(curl -s -F audio=@/path/to/audio.mp3 -F language=en localhost:8001/jobs | jq -r .jobId)
curl -s localhost:8001/jobs/$JID | jq      # status: queued|running|done|error
```

`modelLoaded` flips `true` → `false` after `WHISPERX_IDLE_TTL_SECONDS` of inactivity.

## API

| Method | Path          | Body / Notes |
|--------|---------------|--------------|
| POST   | `/jobs`       | multipart `audio=<file>`, optional `language` (ISO 639-1), optional `device` (cpu/cuda) → `{ jobId }` (202) |
| GET    | `/jobs/{id}`  | → `{ status, result?, error? }` |
| GET    | `/health`     | → `{ status, modelLoaded, device, idleSeconds, queueDepth, busy, diarisationEnabled }` |

`result` shape (normalised; matches the OpenAI path):

```json
{
  "text": "...",
  "language": "en",
  "segments": [{ "speaker": "A", "text": "...", "start": 0.0, "end": 3.2 }],
  "words":    [{ "word": "hello", "start": 0.0, "end": 0.4, "speaker": "A" }],
  "duration": 564.0
}
```

Diarisation labels (`SPEAKER_00/01/…`) are mapped to `A/B/C…` by first appearance
to match the "A, B, C" style the backend's segmentation step expects before it
semantically relabels speakers to DOCTOR/PATIENT/SPECIALIST.

## Running without Docker (optional)

Not required, but possible for hacking: create a venv, install a torch build
(`--index-url https://download.pytorch.org/whl/cpu` or `/cu121`), then
`pip install -r requirements.txt` and `python app.py`. The Docker path above is
the supported one.
