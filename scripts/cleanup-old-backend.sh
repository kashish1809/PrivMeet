#!/usr/bin/env bash
# Remove the Python backend a checkout from before the Rust server still has on disk.
#
#   scripts/cleanup-old-backend.sh [--dry-run]
#
# `backend/` was deleted from git, but git never removes files it does not track, so every
# checkout that once ran the old backend still carries its virtualenv, caches and models:
# about 9 GB. This moves what the Rust server can still use into native/server/data and
# deletes the rest. It does nothing when there is no backend/ folder, so it is safe to run
# from a git hook on every pull (.githooks/post-merge).
#
# Nothing here is tracked by git, so nothing it touches can be recovered with git.
set -euo pipefail

DRY=0
[[ ${1:-} == "--dry-run" ]] && DRY=1

ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "not a git checkout" >&2; exit 1; }
OLD="$ROOT/backend"
NEW="$ROOT/native/server/data"
[[ -d $OLD ]] || exit 0

say() { echo "privmeet: $*"; }
run() { if (( DRY )); then echo "  would: $*"; else "$@"; fi; }

size() { du -sh "$1" 2>/dev/null | cut -f1 || echo "?"; }

say "found an old Python backend at backend/ ($(size "$OLD")). Tidying it up."

# 1. Keep what the Rust server still reads: the recordings, the speaker models and the
#    database, which `privmeet-server import-django` turns into meetings.
keep() { # <source> <destination>
  local from=$1 to=$2
  [[ -e $from ]] || return 0
  if [[ -e $to ]]; then
    say "keeping your own $(basename "$to"); leaving $from alone"
    return 0
  fi
  run mkdir -p "$(dirname "$to")"
  run mv "$from" "$to"
  say "kept $(basename "$from") -> ${to#"$ROOT/"}"
}

keep "$OLD/data/media/uploads"            "$NEW/media/uploads"
keep "$OLD/data/models/diarize"           "$NEW/models/diarize"
keep "$OLD/data/db.sqlite3"               "$NEW/django-db.sqlite3"
keep "$OLD/data/settings.json"            "$NEW/django-settings.json"

# 2. Everything else is the Python install itself: the virtualenv, the caches, the source
#    and the faster-whisper model cache, which whisper.cpp cannot read.
say "removing backend/ ($(size "$OLD") left)"
run rm -rf "$OLD"

if [[ -f $NEW/django-db.sqlite3 && ! -f $NEW/privmeet.sqlite3 ]]; then
  cat <<EOF

Your old meetings are kept. To bring them into the Rust server:

  cd native/server && cargo build --release
  ./target/release/privmeet-server import-django data/django-db.sqlite3

The recordings are already in place, so the import only copies the rows.
EOF
fi

say "done."
