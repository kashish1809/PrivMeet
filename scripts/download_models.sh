#!/usr/bin/env bash
# Download the sherpa-onnx speaker-diarization models for local (non-Docker) runs.
# Safe to re-run: files that already exist are skipped.
set -euo pipefail

DEST="${DIARIZE_MODELS_DIR:-$(cd "$(dirname "$0")/.." && pwd)/backend/data/models/diarize}"
BASE=https://github.com/k2-fsa/sherpa-onnx/releases/download
SEG_URL="$BASE/speaker-segmentation-models/sherpa-onnx-pyannote-segmentation-3-0.tar.bz2"

mkdir -p "$DEST"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

if [[ -s "$DEST/segmentation.onnx" ]]; then
  echo "segmentation.onnx already present, skipping"
else
  echo "Downloading speaker segmentation model..."
  curl -fL --retry 3 -o "$tmp/seg.tar.bz2" "$SEG_URL"
  tar -xjf "$tmp/seg.tar.bz2" -C "$tmp"
  mv "$tmp/sherpa-onnx-pyannote-segmentation-3-0/model.onnx" "$DEST/segmentation.onnx"
fi

echo "Models in $DEST:"
ls -lh "$DEST"
