# WhisperX transcription sidecar.
#
# A CUDA-capable torch build is pulled in transitively by whisperx; it runs on
# CPU by default (WHISPERX_DEVICE=cpu) with no GPU/driver needed. For GPU, run
# this same image with the NVIDIA Container Toolkit and set WHISPERX_DEVICE=cuda
# (see the `deploy` block in docker/docker-compose.*.yml).
FROM python:3.12-slim

# ffmpeg: whisperx decodes audio via ffmpeg. git: some ML deps resolve from VCS.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg git \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py ./

EXPOSE 8001

# Model + Hugging Face caches persist via a volume mounted at /root/.cache
# (see the compose service) so they download once, not on every cold start.
CMD ["python", "app.py"]
