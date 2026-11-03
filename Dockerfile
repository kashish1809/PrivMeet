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
