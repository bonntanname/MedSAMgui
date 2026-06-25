#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# Launch MedSAM backend (FastAPI/uvicorn) and frontend (Vite) together.
# On first run, downloads the MedSAM checkpoint if it is missing.
# Runs both in this one terminal; Ctrl+C stops BOTH.
# Ideal for a remote server over SSH (forward port 5173 to your laptop).
# -----------------------------------------------------------------------------
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_PORT="${BACKEND_PORT:-8000}"

# Vite 8 requires Node >=20.19. The system node is v18, so load nvm's node 20
# here (this script runs non-interactively and would not source ~/.bashrc).
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [ -s "$NVM_DIR/nvm.sh" ]; then
    # shellcheck disable=SC1091
    \. "$NVM_DIR/nvm.sh"
    nvm use 20 >/dev/null 2>&1 || nvm use default >/dev/null 2>&1 || true
fi

CKPT="$ROOT/work_dir/MedSAM/medsam_vit_b.pth"
GDRIVE_ID="1UAmWL88roYR7wKlnApw5Bcuzf2iQgk6_"

# --- checkpoint: download only if missing ---
if [ -f "$CKPT" ]; then
    echo "[ckpt] Found $CKPT, skipping download."
else
    echo "[ckpt] Not found. Downloading MedSAM checkpoint (~360MB) via gdown..."
    mkdir -p "$ROOT/work_dir/MedSAM"
    uvx gdown "$GDRIVE_ID" -O "$CKPT"
    [ -f "$CKPT" ] || { echo "[ckpt] ERROR: download failed. Aborting."; exit 1; }
    echo "[ckpt] Download complete."
fi

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
