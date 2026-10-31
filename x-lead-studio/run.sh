#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PYTHON_BIN="$SCRIPT_DIR/.venv/bin/python"

if [ ! -x "$PYTHON_BIN" ]; then
  echo "Create x-lead-studio/.venv and install requirements.txt first." >&2
  exit 1
fi

exec "$PYTHON_BIN" -m uvicorn lead_studio.app:app --app-dir "$SCRIPT_DIR" --host 127.0.0.1 --port 8020
