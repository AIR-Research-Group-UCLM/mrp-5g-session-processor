#!/usr/bin/env python3
"""Local WhisperX transcription sidecar for the MRP 5G session processor.

A drop-in, fully local replacement for the cloud `gpt-4o-transcribe-diarize`
endpoint: faster-whisper ASR -> wav2vec2 word alignment -> pyannote diarisation,
normalised to the exact JSON shape the Node backend already consumes.

Lifecycle (single instance, lazy + warm + idle-release):
  * one model in memory at most, behind an internal single-worker queue;
  * COLD START: the model is loaded on the first queued job;
  * KEEP WARM: it stays resident for WHISPERX_IDLE_TTL_SECONDS after the last job;
  * RELEASE: once idle past the TTL it is unloaded and GPU/RAM is freed.

This avoids permanently co-residing with gpt-oss:20b on a shared GPU: WhisperX
only holds VRAM while there is work (plus the warm window), then lets go.

API
  POST /jobs        multipart: audio=<file>, language?=<iso639-1>, device?=cpu|cuda
                    -> { "jobId": "..." }
  GET  /jobs/{id}   -> { "status": queued|running|done|error, "result"?, "error"? }
  GET  /health      -> { "status", "modelLoaded", "device", "idleSeconds", "queueDepth", "busy" }
"""
from __future__ import annotations

import asyncio
import gc
import os
import tempfile
import threading
import time
import uuid
from contextlib import asynccontextmanager
from typing import Any, Optional

from fastapi import FastAPI, Form, HTTPException, UploadFile, File
from fastapi.responses import JSONResponse

import whisperx

# --------------------------------------------------------------------------- #
# Config (env)
# --------------------------------------------------------------------------- #
DEFAULT_DEVICE = os.environ.get("WHISPERX_DEVICE", "cpu").lower()
if DEFAULT_DEVICE == "gpu":  # friendly alias
    DEFAULT_DEVICE = "cuda"
MODEL_NAME = os.environ.get("WHISPERX_MODEL", "large-v3")
COMPUTE_OVERRIDE = os.environ.get("WHISPERX_COMPUTE_TYPE")  # else derived from device
IDLE_TTL = float(os.environ.get("WHISPERX_IDLE_TTL_SECONDS", "300"))
BATCH_SIZE = int(os.environ.get("WHISPERX_BATCH_SIZE", "8"))
# Accept either WHISPERX_HF_TOKEN or the conventional HF_TOKEN for the gated
# pyannote diarisation model.
HF_TOKEN = os.environ.get("WHISPERX_HF_TOKEN") or os.environ.get("HF_TOKEN")
MIN_SPEAKERS = int(os.environ.get("WHISPERX_MIN_SPEAKERS", "2"))
MAX_SPEAKERS = int(os.environ.get("WHISPERX_MAX_SPEAKERS", "4"))
# How often the idle reaper checks (seconds).
REAPER_INTERVAL = 15.0
# Drop finished job records older than this (seconds) to bound memory.
JOB_RETENTION = 3600.0


def compute_type_for(device: str) -> str:
    if COMPUTE_OVERRIDE:
        return COMPUTE_OVERRIDE
    return "float16" if device == "cuda" else "int8"


def log(msg: str) -> None:
    print(f"[whisperx-service] {msg}", flush=True)


# --------------------------------------------------------------------------- #
# Model manager — lazy load, keep warm, unload to free resources
# --------------------------------------------------------------------------- #
class ModelManager:
    """Holds at most one set of models. Thread-safe load/unload/transcribe so the
    idle reaper (event loop) never races the worker thread (executor)."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self.device: Optional[str] = None
        self.compute_type: Optional[str] = None
        self._asr = None
        self._asr_lang: Optional[str] = None  # language fixed at ASR load (None = auto)
        self._align: dict[str, tuple[Any, Any]] = {}  # language -> (model, metadata)
        self._diarize = None
        self.last_used: float = time.time()
        self.busy: bool = False

    # --- introspection (lock-free reads; good enough for /health) ---
    @property
    def loaded(self) -> bool:
        return self._asr is not None

    def idle_seconds(self) -> float:
        return time.time() - self.last_used

    # --- lifecycle ---
    def _ensure_device(self, device: str) -> None:
        """If the requested device differs from what's loaded, drop everything."""
        if self.loaded and self.device != device:
            log(f"device change {self.device} -> {device}, unloading")
            self._unload_locked()

    def _load_asr(self, device: str, language: Optional[str]) -> None:
        ct = compute_type_for(device)
        if self._asr is not None and self._asr_lang == language and self.device == device:
            return
        if self._asr is not None:
            # language change -> reload ASR (cheap relative to a full job)
            self._asr = None
        log(f"loading ASR model={MODEL_NAME} device={device} compute={ct} lang={language or 'auto'}")
        self._asr = whisperx.load_model(
            MODEL_NAME, device, compute_type=ct, language=language
        )
        self._asr_lang = language
        self.device = device
        self.compute_type = ct

    def _get_align(self, language: str, device: str):
        key = f"{language}:{device}"
        if key not in self._align:
            log(f"loading alignment model for lang={language} device={device}")
            model, meta = whisperx.load_align_model(language_code=language, device=device)
            self._align[key] = (model, meta)
        return self._align[key]

    def _get_diarize(self, device: str):
        if self._diarize is None:
            if not HF_TOKEN:
                raise RuntimeError(
                    "No HF token set (WHISPERX_HF_TOKEN/HF_TOKEN) — pyannote diarisation "
                    "model is gated and cannot be loaded."
                )
            from whisperx.diarize import DiarizationPipeline
            log(f"loading diarisation pipeline device={device}")
            self._diarize = DiarizationPipeline(token=HF_TOKEN, device=device)
        return self._diarize

    def _unload_locked(self) -> None:
        had = self.loaded
        self._asr = None
        self._asr_lang = None
        self._align = {}
        self._diarize = None
        self.device = None
        self.compute_type = None
        gc.collect()
        try:
            import torch

            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        except Exception:  # noqa: BLE001 — best-effort VRAM release
            pass
        if had:
            log("models unloaded, resources released")

    def maybe_unload_if_idle(self, ttl: float) -> bool:
        """Called by the reaper. Returns True if it unloaded."""
        if self.busy or not self.loaded:
            return False
        if self.idle_seconds() < ttl:
            return False
        # Don't block the loop: if the worker holds the lock, skip this tick.
        if not self._lock.acquire(blocking=False):
            return False
        try:
            if self.busy or not self.loaded or self.idle_seconds() < ttl:
                return False
            self._unload_locked()
            return True
        finally:
            self._lock.release()

    def transcribe(
        self, audio_path: str, language: Optional[str], device: str
    ) -> dict:
        """Blocking; runs inside the worker's executor thread."""
        with self._lock:
            self.busy = True
            self.last_used = time.time()
            try:
                self._ensure_device(device)
                self._load_asr(device, language)
                return _run_pipeline(self, audio_path, language, device)
            finally:
                self.busy = False
                self.last_used = time.time()


def _map_speakers(segments: list[dict]) -> dict[str, str]:
    """Map pyannote labels (SPEAKER_00/01/..) to A/B/C by first appearance, to
    match the 'A, B, C' style the downstream segmentation step expects."""
    mapping: dict[str, str] = {}
    next_idx = 0
    for seg in segments:
        spk = seg.get("speaker")
        if spk and spk not in mapping:
            mapping[spk] = chr(ord("A") + next_idx)
            next_idx += 1
    return mapping


def _run_pipeline(mgr: ModelManager, audio_path: str, language: Optional[str], device: str) -> dict:
    audio = whisperx.load_audio(audio_path)
    duration = round(len(audio) / 16000.0, 2)

    asr = mgr._asr.transcribe(audio, batch_size=BATCH_SIZE)
    detected_lang = asr.get("language") or language or "en"

    align_model, meta = mgr._get_align(detected_lang, device)
    aligned = whisperx.align(
        asr["segments"], align_model, meta, audio, device, return_char_alignments=False
    )

    final = aligned
    diarised = False
    try:
        from whisperx.diarize import assign_word_speakers

        diar = mgr._get_diarize(device)
        try:
            diar_segments = diar(audio, min_speakers=MIN_SPEAKERS, max_speakers=MAX_SPEAKERS)
        except TypeError:  # older signature without speaker hints
            diar_segments = diar(audio)
        final = assign_word_speakers(diar_segments, aligned)
        diarised = True
    except Exception as exc:  # noqa: BLE001 — surface but degrade to ASR-only
        log(f"diarisation failed ({type(exc).__name__}: {exc}); returning ASR-only output")

    raw_segments = final.get("segments", [])
    spk_map = _map_speakers(raw_segments) if diarised else {}

    def label(spk: Optional[str]) -> str:
        if not spk:
            return "A"
        return spk_map.get(spk, spk)

    segments: list[dict] = []
    words: list[dict] = []
    text_parts: list[str] = []
    for seg in raw_segments:
        seg_text = (seg.get("text") or "").strip()
        seg_speaker = label(seg.get("speaker"))
        segments.append(
            {
                "speaker": seg_speaker,
                "text": seg_text,
                "start": round(float(seg.get("start", 0.0)), 2),
                "end": round(float(seg.get("end", 0.0)), 2),
            }
        )
        if seg_text:
            text_parts.append(seg_text)
        for w in seg.get("words", []) or []:
            word_text = (w.get("word") or "").strip()
            if not word_text:
                continue
            words.append(
                {
                    "word": word_text,
                    "start": round(float(w["start"]), 2) if w.get("start") is not None else 0.0,
                    "end": round(float(w["end"]), 2) if w.get("end") is not None else 0.0,
                    "speaker": label(w.get("speaker")),
                }
            )

    return {
        "text": " ".join(text_parts).strip(),
        "language": detected_lang,
        "segments": segments,
        "words": words,
        "duration": duration,
        "diarised": diarised,
    }


# --------------------------------------------------------------------------- #
# Job queue (single worker => single model instance)
# --------------------------------------------------------------------------- #
manager = ModelManager()
jobs: dict[str, dict] = {}
# Created inside the running loop (lifespan) so it binds to uvicorn's event loop
# on every supported Python (3.9 would otherwise bind to the wrong loop at import).
job_queue: "Optional[asyncio.Queue[str]]" = None


def _queue() -> "asyncio.Queue[str]":
    if job_queue is None:
        raise RuntimeError("job queue not initialised")
    return job_queue


async def _worker() -> None:
    loop = asyncio.get_running_loop()
    queue = _queue()
    while True:
        job_id = await queue.get()
        job = jobs.get(job_id)
        if job is None:
            queue.task_done()
            continue
        job["status"] = "running"
        audio_path = job["audio_path"]
        log(f"job {job_id} running (queue depth now {queue.qsize()})")
        try:
            result = await loop.run_in_executor(
                None, manager.transcribe, audio_path, job["language"], job["device"]
            )
            job["status"] = "done"
            job["result"] = result
            job["finished_at"] = time.time()
            log(f"job {job_id} done ({len(result['segments'])} segments, lang={result['language']})")
        except Exception as exc:  # noqa: BLE001
            job["status"] = "error"
            job["error"] = f"{type(exc).__name__}: {exc}"
            job["finished_at"] = time.time()
            log(f"job {job_id} FAILED: {job['error']}")
        finally:
            try:
                os.unlink(audio_path)
            except OSError:
                pass
            queue.task_done()


async def _reaper() -> None:
    while True:
        await asyncio.sleep(REAPER_INTERVAL)
        try:
            if _queue().empty():
                manager.maybe_unload_if_idle(IDLE_TTL)
            # prune old finished jobs
            now = time.time()
            stale = [
                jid
                for jid, j in jobs.items()
                if j.get("finished_at") and now - j["finished_at"] > JOB_RETENTION
            ]
            for jid in stale:
                jobs.pop(jid, None)
        except Exception as exc:  # noqa: BLE001
            log(f"reaper error: {exc}")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    global job_queue
    log(
        f"starting | model={MODEL_NAME} default_device={DEFAULT_DEVICE} "
        f"idle_ttl={IDLE_TTL}s diarisation={'on' if HF_TOKEN else 'OFF (no HF token)'}"
    )
    job_queue = asyncio.Queue()
    worker_task = asyncio.create_task(_worker())
    reaper_task = asyncio.create_task(_reaper())
    try:
        yield
    finally:
        worker_task.cancel()
        reaper_task.cancel()


app = FastAPI(title="WhisperX transcription sidecar", lifespan=lifespan)


@app.get("/health")
async def health() -> dict:
    return {
        "status": "ok",
        "modelLoaded": manager.loaded,
        "device": manager.device or DEFAULT_DEVICE,
        "idleSeconds": round(manager.idle_seconds(), 1),
        "queueDepth": _queue().qsize() if job_queue is not None else 0,
        "busy": manager.busy,
        "diarisationEnabled": bool(HF_TOKEN),
    }


@app.post("/jobs")
async def create_job(
    audio: UploadFile = File(...),
    language: Optional[str] = Form(None),
    device: Optional[str] = Form(None),
) -> JSONResponse:
    dev = (device or DEFAULT_DEVICE).lower()
    if dev == "gpu":
        dev = "cuda"
    if dev not in ("cpu", "cuda"):
        raise HTTPException(status_code=400, detail=f"invalid device '{dev}'")

    # Persist the upload to a temp file the worker can read.
    suffix = os.path.splitext(audio.filename or "audio.mp3")[1] or ".mp3"
    fd, tmp_path = tempfile.mkstemp(prefix="wx-", suffix=suffix)
    try:
        with os.fdopen(fd, "wb") as f:
            while chunk := await audio.read(1024 * 1024):
                f.write(chunk)
    except Exception:
        os.unlink(tmp_path)
        raise

    job_id = uuid.uuid4().hex
    jobs[job_id] = {
        "status": "queued",
        "audio_path": tmp_path,
        "language": (language or None),
        "device": dev,
        "created_at": time.time(),
    }
    await _queue().put(job_id)
    log(f"job {job_id} queued (device={dev}, lang={language or 'auto'})")
    return JSONResponse(status_code=202, content={"jobId": job_id})


@app.get("/jobs/{job_id}")
async def get_job(job_id: str) -> dict:
    job = jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="job not found")
    payload: dict = {"status": job["status"]}
    if job["status"] == "done":
        payload["result"] = job["result"]
    elif job["status"] == "error":
        payload["error"] = job.get("error", "unknown error")
    return payload


if __name__ == "__main__":
    import uvicorn

    host = os.environ.get("WHISPERX_SERVICE_HOST", "0.0.0.0")
    port = int(os.environ.get("WHISPERX_SERVICE_PORT", "8001"))
    uvicorn.run(app, host=host, port=port)
