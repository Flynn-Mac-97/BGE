#!/usr/bin/env bash
#
# Run the vendored Trellis CLI (vendor/trellis), falling back to the original
# converted checkout if the vendored copy is absent.
#
#   trellis.sh audit .                 # human-readable report
#   trellis.sh audit src --json        # machine-readable
#   trellis.sh compare before.json after.json
#   trellis.sh guide cleanup
#
# Resolution order:
#   checkout: $TRELLIS_DIR, vendored copy, then known local paths
#   runtime:  $TRELLIS_BUN, project-local bun, then the external shim
#
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_dir="$(cd "$script_dir/../../.." && pwd)"

checkout_candidates=(
  "${TRELLIS_DIR:-}"
  "$project_dir/vendor/trellis"
  "/z/Code/browser game engine/agent-runs/trellis-evaluation"
  "Z:/Code/browser game engine/agent-runs/trellis-evaluation"
)

resolved_dir=""
for candidate in "${checkout_candidates[@]}"; do
  if [ -n "$candidate" ] && [ -f "$candidate/src/cli/main.ts" ]; then
    resolved_dir="$candidate"
    break
  fi
done

if [ -z "$resolved_dir" ]; then
  echo "trellis.sh: cannot locate a Trellis checkout." >&2
  echo "Set TRELLIS_DIR to the directory containing src/cli/main.ts." >&2
  exit 1
fi

bun_candidates=(
  "${TRELLIS_BUN:-}"
  "$project_dir/node_modules/.bin/bun"
  "$project_dir/node_modules/bun/bin/bun.exe"
  "/z/Code/browser game engine/agent-runs/trellis-runtime/node_modules/bun/bin/bun.exe"
  "$(command -v bun 2>/dev/null || true)"
)

resolved_bun=""
for candidate in "${bun_candidates[@]}"; do
  if [ -n "$candidate" ] && [ -x "$candidate" ]; then
    resolved_bun="$candidate"
    break
  fi
done

if [ -z "$resolved_bun" ]; then
  echo "trellis.sh: cannot find a bun runtime." >&2
  echo "Set TRELLIS_BUN to a bun executable, or run: npm install" >&2
  exit 1
fi

exec "$resolved_bun" "$resolved_dir/src/cli/main.ts" "$@"
