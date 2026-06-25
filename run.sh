#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# Launch MedSAM backend (FastAPI/uvicorn) and frontend (Vite) together.
# Runs both in this one terminal; Ctrl+C stops BOTH.
# Ideal for a remote server over SSH (forward port 5173 to your laptop).
# -----------------------------------------------------------------------------
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_PORT="${BACKEND_PORT:-8000}"

# Kill the whole process group (both children) on exit / Ctrl+C.
cleanup() { trap - EXIT INT TERM; kill 0 2>/dev/null || true; }
trap cleanup EXIT INT TERM

echo "Starting MedSAM backend  -> http://127.0.0.1:${BACKEND_PORT}"
echo "Starting MedSAM frontend -> http://localhost:5173"
echo "(over SSH: forward port 5173, then open http://localhost:5173 locally)"
echo

( cd "$ROOT/medsam-uv" && uv run uvicorn server:app --port "$BACKEND_PORT" ) &
( cd "$ROOT/webapp" && npm run dev ) &

wait
