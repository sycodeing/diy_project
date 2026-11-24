#!/bin/sh
set -eu
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if [ ! -x "$SCRIPT_DIR/.venv/bin/python" ]; then
  echo "The project Python environment is not installed." >&2
  exit 1
fi
cd "$SCRIPT_DIR"
exec "$SCRIPT_DIR/.venv/bin/python" -m lead_studio.account_manual_helper
