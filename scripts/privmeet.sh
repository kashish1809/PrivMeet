#!/usr/bin/env bash
# PrivMeet stack launcher for people who did not install the desktop app.
# Everything it runs is plain `docker compose`; read the file before you run it.
# Run `scripts/privmeet.sh help` for the commands.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
URL=http://127.0.0.1:8000

die() { echo "privmeet: $*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

usage() {
  cat <<'EOF'
usage: scripts/privmeet.sh <command> [service]

  up                start the stack, add the GPU override when nvidia-smi
                    works, then open http://127.0.0.1:8000
  down              stop the stack; the data volumes are kept
  logs [service]    follow the logs
EOF
  exit "${1:-0}"
}

# compose.gpu.yml arrives with T1.5. Until it is on main this is CPU only.
gpu_ok() {
  [[ -f compose.gpu.yml ]] && have nvidia-smi && nvidia-smi -L >/dev/null 2>&1
}

compose() {
  if gpu_ok; then
    docker compose -f compose.yml -f compose.gpu.yml "$@"
  else
    docker compose "$@"
  fi
}

# The stack refuses to start without SECRET_KEY, so make one on the first run
# instead of failing with a compose interpolation error.
ensure_env() {
  [[ -f .env ]] && return 0
  [[ -f .env.example ]] || die "no .env.example here; run this from the PrivMeet checkout"
  cp .env.example .env
  local key=""
  if have openssl; then
    key=$(openssl rand -base64 48 | tr -d '\n')
  elif [[ -r /dev/urandom ]] && have base64; then
    key=$(head -c 48 /dev/urandom | base64 | tr -d '\n')
  else
    die "cannot generate a SECRET_KEY. Copy .env.example to .env and set it by hand."
  fi
  # A Windows checkout hands .env CRLF endings; compose would keep the \r in values.
  sed -i -e 's/\r$//' -e "s|^SECRET_KEY=.*|SECRET_KEY=${key}|" .env
  echo "Created .env with a new SECRET_KEY. Change POSTGRES_PASSWORD there if you like."
}

need_docker() {
  have docker || die "docker is not installed: https://docs.docker.com/engine/install/"
  docker info >/dev/null 2>&1 || die "Docker is not running. Start Docker and try again."
}

open_browser() {
  if have xdg-open; then xdg-open "$URL" >/dev/null 2>&1 || true
  elif have open; then open "$URL" >/dev/null 2>&1 || true
  else echo "Open $URL in your browser."
  fi
}

wait_for_server() {
  if ! have curl; then
    echo "curl is missing, so I cannot wait. Give it a minute, then open $URL"
    return 0
  fi
  printf 'Waiting for the server'
  for _ in $(seq 1 60); do
    if curl -fsS "$URL/api/system/" >/dev/null 2>&1; then
      printf '\nPrivMeet is up: %s\n' "$URL"
      open_browser
      return 0
    fi
    printf '.'
    sleep 2
  done
  printf '\n'
  die "no answer after 2 minutes. Try: scripts/privmeet.sh logs web"
}

cmd_up() {
  ensure_env
  need_docker
  if gpu_ok; then echo "NVIDIA GPU found, using compose.gpu.yml."; fi
  compose up -d
  wait_for_server
}

cmd_down() {
  ensure_env
  need_docker
  compose down
}

cmd_logs() {
  ensure_env
  need_docker
  compose logs -f --tail=100 "$@"
}

case "${1:-}" in
  up) shift; cmd_up "$@" ;;
  down) shift; cmd_down "$@" ;;
  logs) shift; cmd_logs "$@" ;;
  help | -h | --help) usage 0 ;;
  *) usage 1 ;;
esac
