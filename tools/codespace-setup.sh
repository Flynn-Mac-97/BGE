#!/usr/bin/env bash
# Set up a GitHub Codespace (or any Linux box) to run the engine: packages, a
# Chrome for the See plugin's frames and lane browsers, and the projects repo
# cloned beside the checkout, where ENGINE_PROJECTS_ROOT points.
#   bash tools/codespace-setup.sh          the whole setup (the devcontainer runs it once)
#   bash tools/codespace-setup.sh --check  say what is ready and what is not
# Kimodo, SAM 3D Body and Blender need a GPU or a local install, so they stay on
# the desktop; their commands say so here and nothing else breaks.
set -euo pipefail
cd "$(dirname "$0")/.."

PROJECTS_ROOT="${ENGINE_PROJECTS_ROOT:-$(cd .. && pwd)/engine-projects}"
PROJECTS_REPO="${ENGINE_PROJECTS_REPO:-Flynn-Mac-97/BGE-projects}"

check() {
  local ready=0
  command -v node >/dev/null && echo "node      $(node -v)" || { echo "node      missing"; ready=1; }
  [ -d node_modules ] && echo "packages  installed" || { echo "packages  missing: npm ci"; ready=1; }
  command -v google-chrome >/dev/null && echo "chrome    $(google-chrome --version)" || echo "chrome    missing: pictures (see.capture, lanes) will not work"
  [ -d "$PROJECTS_ROOT/.git" ] && echo "projects  $PROJECTS_ROOT" || { echo "projects  missing: gh repo clone $PROJECTS_REPO $PROJECTS_ROOT"; ready=1; }
  echo
  echo "Start the editor:  node bin/engine.mjs supervisor.open dev-server   (port 5180 opens in the browser)"
  echo "Headless:          node bin/engine.mjs --headless --project $PROJECTS_ROOT/<game> snapshot"
  return $ready
}

if [ "${1:-}" = "--check" ]; then
  check || true
  exit 0
fi

npm ci

# Google's Chrome deb brings its own libraries, and /usr/bin/google-chrome is
# one of the places engine/chrome-path.mjs looks.
if ! command -v google-chrome >/dev/null; then
  deb=/tmp/google-chrome.deb
  curl -fsSL -o "$deb" https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
  sudo apt-get update -qq
  sudo apt-get install -y -qq "$deb"
  rm -f "$deb"
fi
# A container has no user namespaces for Chrome's sandbox, so the Chrome the
# engine starts (CHROME_PATH, in devcontainer.json) runs without it.
if [ ! -x /usr/local/bin/chrome-in-container ]; then
  printf '#!/bin/sh\nexec google-chrome --no-sandbox "$@"\n' | sudo tee /usr/local/bin/chrome-in-container >/dev/null
  sudo chmod +x /usr/local/bin/chrome-in-container
fi

if [ ! -d "$PROJECTS_ROOT/.git" ]; then
  gh repo clone "$PROJECTS_REPO" "$PROJECTS_ROOT"
fi

check || true
