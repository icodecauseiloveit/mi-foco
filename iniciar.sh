#!/usr/bin/env bash
# Mi Foco - arranque en macOS/Linux.
cd "$(dirname "$0")"
if [ ! -x ".venv/bin/python" ]; then
  python3 -m venv .venv && .venv/bin/pip install -q -r requirements.txt || exit 1
fi
exec .venv/bin/python app.py "$@"
