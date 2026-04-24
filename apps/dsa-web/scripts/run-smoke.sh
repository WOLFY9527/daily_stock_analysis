#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${APP_DIR}/../.." && pwd)"

BACKEND_LOG="${TMPDIR:-/tmp}/dsa-web-smoke-backend.log"
PREVIEW_LOG="${TMPDIR:-/tmp}/dsa-web-smoke-preview.log"

cleanup() {
  if [[ -n "${PREVIEW_PID:-}" ]]; then
    kill "${PREVIEW_PID}" >/dev/null 2>&1 || true
  fi
  if [[ -n "${BACKEND_PID:-}" ]]; then
    kill "${BACKEND_PID}" >/dev/null 2>&1 || true
  fi
}

wait_for_url() {
  local url="$1"
  local label="$2"
  local attempts=0
  until curl -fsS "${url}" >/dev/null 2>&1; do
    attempts=$((attempts + 1))
    if [[ "${attempts}" -ge 60 ]]; then
      echo "Timed out waiting for ${label} at ${url}" >&2
      return 1
    fi
    sleep 1
  done
}

trap cleanup EXIT INT TERM

cd "${APP_DIR}"
npm run build

cd "${REPO_ROOT}"
python3 main.py --serve-only --host 127.0.0.1 --port 8000 >"${BACKEND_LOG}" 2>&1 &
BACKEND_PID=$!

cd "${APP_DIR}"
npm run preview -- --host 127.0.0.1 --port 4173 >"${PREVIEW_LOG}" 2>&1 &
PREVIEW_PID=$!

wait_for_url "http://127.0.0.1:8000/api/v1/auth/status" "backend smoke server"
wait_for_url "http://127.0.0.1:4173/" "frontend smoke preview"

npx playwright test e2e/smoke.spec.ts "$@"
