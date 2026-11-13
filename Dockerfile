# syntax=docker/dockerfile:1
# PrivMeet image: React built to static files, served by Django/whitenoise.
# No PyTorch: Whisper runs on CTranslate2 and diarization on sherpa-onnx.

# Stage 1: build the frontend. Node never reaches the final image.
FROM node:22-slim AS frontend
WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Stage 2: runtime. ffmpeg for probing/decoding, the ONNX diarization models
# baked in so the first run needs no extra download, and no GPU by default.
FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 \
    DATA_DIR=/data \
    DIARIZE_MODELS_DIR=/opt/models/diarize
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg curl ca-certificates bzip2 \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

# GPU=1 adds the CUDA runtime libraries CTranslate2 needs on an NVIDIA host.
# The driver itself comes from the host via the compose device reservation.
ARG GPU=0
RUN if [ "$GPU" = "1" ]; then \
        pip install --no-cache-dir nvidia-cublas-cu12 'nvidia-cudnn-cu12==9.*'; \
        echo "/usr/local/lib/python3.12/site-packages/nvidia/cublas/lib:/usr/local/lib/python3.12/site-packages/nvidia/cudnn/lib" \
            > /etc/ld.so.conf.d/nvidia.conf; \
        ldconfig; \
    fi

# Same sources as scripts/download_models.sh; "recongition" is the upstream tag's spelling.
RUN set -eux; \
    mkdir -p "$DIARIZE_MODELS_DIR"; \
    curl -fsSL --retry 3 -o /tmp/seg.tar.bz2 \
        https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-segmentation-models/sherpa-onnx-pyannote-segmentation-3-0.tar.bz2; \
    tar -xjf /tmp/seg.tar.bz2 -C /tmp; \
    mv /tmp/sherpa-onnx-pyannote-segmentation-3-0/model.onnx "$DIARIZE_MODELS_DIR/segmentation.onnx"; \
    curl -fsSL --retry 3 -o "$DIARIZE_MODELS_DIR/embedding.onnx" \
        https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/3dspeaker_speech_campplus_sv_en_voxceleb_16k.onnx; \
    rm -rf /tmp/seg.tar.bz2 /tmp/sherpa-onnx-pyannote-segmentation-3-0

COPY backend/ /app
COPY --from=frontend /build/frontend/dist /app/frontend_dist
# Secret key here is throwaway: collectstatic never serves a request, and
# settings.py rejects the built-in key because DEBUG is off in the image.
RUN SECRET_KEY=build-only python manage.py collectstatic --noinput

EXPOSE 8000
CMD ["gunicorn", "privmeet.wsgi", "-b", "0.0.0.0:8000", "-w", "2", "--timeout", "300"]
