# syntax=docker/dockerfile:1
# PrivMeet image: one Rust binary (native/server) that serves the API and the built React app,
# and runs the pipeline itself (whisper.cpp, sherpa-onnx diarization, Ollama or a cloud LLM).
# No Python, Celery, Redis or Postgres.
#
# GPU=1 builds whisper.cpp with CUDA on NVIDIA's images (tag <version>-gpu, compose.gpu.yml).
ARG GPU=0

# Stage 1: the frontend. Node never reaches the final image.
FROM node:22-slim AS frontend
WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Stage 2: the server. bindgen needs clang; whisper.cpp needs cmake. Rust is pinned to
# native/server/rust-toolchain.toml (sherpa-rs-sys breaks on newer Cargo build layouts).
FROM rust:1.98.1-bookworm AS build-0
RUN apt-get update && apt-get install -y --no-install-recommends clang cmake && rm -rf /var/lib/apt/lists/*
ENV FEATURES=""

FROM nvidia/cuda:12.6.3-devel-ubuntu24.04 AS build-1
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates build-essential clang cmake pkg-config \
    && rm -rf /var/lib/apt/lists/* \
    && curl -fsSL https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain 1.98.1
ENV PATH=/root/.cargo/bin:$PATH FEATURES="cuda"

FROM build-${GPU} AS build
WORKDIR /build/native/server
COPY native/server/ ./
# sherpa-rs downloads its prebuilt sherpa-onnx libraries and copies them next to the binary
RUN cargo build --release --features "$FEATURES" \
    && mkdir /out && cp target/release/privmeet-server target/release/*.so /out/

# Stage 3: runtime. ffmpeg for probing and decoding, curl for the health check, the ONNX
# diarization models baked in so the first run needs no extra download.
FROM debian:bookworm-slim AS run-0
FROM nvidia/cuda:12.6.3-runtime-ubuntu24.04 AS run-1

FROM run-${GPU}
ENV DATA_DIR=/data \
    MODELS_DIR=/data/models \
    DIARIZE_MODELS_DIR=/opt/models/diarize \
    FRONTEND_DIST=/app/frontend_dist \
    HOST=0.0.0.0 \
    PORT=8000
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg curl ca-certificates bzip2 \
    && rm -rf /var/lib/apt/lists/*

# Same sources as before; "recongition" is the upstream tag's spelling.
RUN set -eux; \
    mkdir -p "$DIARIZE_MODELS_DIR"; \
    curl -fsSL --retry 3 -o /tmp/seg.tar.bz2 \
        https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-segmentation-models/sherpa-onnx-pyannote-segmentation-3-0.tar.bz2; \
    tar -xjf /tmp/seg.tar.bz2 -C /tmp; \
    mv /tmp/sherpa-onnx-pyannote-segmentation-3-0/model.onnx "$DIARIZE_MODELS_DIR/segmentation.onnx"; \
    curl -fsSL --retry 3 -o "$DIARIZE_MODELS_DIR/embedding.onnx" \
        https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/3dspeaker_speech_campplus_sv_en_voxceleb_16k.onnx; \
    rm -rf /tmp/seg.tar.bz2 /tmp/sherpa-onnx-pyannote-segmentation-3-0

# the binary finds the .so files beside it (rpath $ORIGIN, native/server/build.rs)
COPY --from=build /out/ /app/
COPY --from=frontend /build/frontend/dist /app/frontend_dist

EXPOSE 8000
CMD ["/app/privmeet-server"]
