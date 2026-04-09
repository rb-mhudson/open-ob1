#!/bin/bash

err() { echo "ERROR: $*" >&2; }

# Parse flags
LS_MODE=false
for arg in "$@"; do
  case "$arg" in
    -ls) LS_MODE=true ;;
  esac
done

# 1. Path to your script's directory
PROJECT_DIR=~/src/ob1-syncer

# 2. Path to your Node.js executable
NODE_PATH=/usr/local/bin/node

# 3. Load credentials from .env (copy .env.example to .env and fill in your values)
ENV_FILE="$PROJECT_DIR/.env"
if [ ! -f "$ENV_FILE" ]; then
  err "Missing $ENV_FILE — copy .env.example to .env and fill in your credentials"
  exit 1
fi
set -a; source "$ENV_FILE"; set +a

# -ls mode: list local and remote files, then exit
if [ "$LS_MODE" = true ]; then
  echo "=== Local: $PROJECT_DIR/OpenBrainSync ==="
  ls -lh "$PROJECT_DIR/OpenBrainSync" | nl 2>/dev/null || echo "(folder not found)"
  echo ""
  echo "=== Remote: ob1-sync: ==="
  rclone lsl ob1-sync:                 | nl 2>/dev/null || echo "(remote not accessible)"
  exit 0
fi

# Navigate to the project directory and run the sync script
cd "$PROJECT_DIR" || { err "Cannot cd to $PROJECT_DIR"; exit 1; }

"$NODE_PATH" sync_open_brain.mjs >> sync_log.txt 2>&1
rc=$?
date >> sync_log.txt
[ $rc -ne 0 ] && err "Node sync failed (exit $rc) — see sync_log.txt"

# Push local OpenBrainSync folder to Google Drive
rclone sync "$PROJECT_DIR/OpenBrainSync" ob1-sync: >> sync_log.txt 2>&1
rc=$?
[ $rc -ne 0 ] && err "rclone sync failed (exit $rc) — see sync_log.txt"
