#!/usr/bin/env bash
# Prepare a Claude Code on the web session to run the engine: install the
# packages when node_modules is missing, and point CHROME_PATH at the browser
# the session image already holds. Idempotent; the SessionStart hook runs it.
set -euo pipefail
cd "$(dirname "$0")/.."

[ -d node_modules ] || npm ci --no-audit --no-fund >&2

chrome=$(ls -d /opt/pw-browsers/chromium-*/chrome-linux*/chrome 2>/dev/null | head -1 || true)
if [ -n "$chrome" ] && [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo "export CHROME_PATH=$chrome" >> "$CLAUDE_ENV_FILE"
fi
