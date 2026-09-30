#!/usr/bin/env bash
# Prepare a Claude Code on the web session to run the engine: install the
# packages when node_modules is missing. The engine finds the browser itself, in
# the Playwright cache the session image holds. Idempotent; the SessionStart
# hook runs it.
set -euo pipefail
cd "$(dirname "$0")/.."

[ -d node_modules ] || npm ci --no-audit --no-fund >&2
