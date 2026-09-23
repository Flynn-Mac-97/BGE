---
name: trellis-audit
description: Run the local converted Trellis structural audit (sloppiness index, complexity hotspots, duplication, import cycles) over JavaScript/TypeScript workspaces. Use when assessing code health, choosing refactors, comparing structure before/after a change, or enforcing quality budgets.
---

# Trellis audit

Trellis is a deterministic, offline structural audit. It parses a workspace and
scores **sloppiness from 0–100 (lower is better)** from four measurement
families: complexity/erosion, duplication, import cycles, plus a separate
non-scoring safeguards inspection. No models, no network; the default run writes
nothing.

A converted JavaScript checkout is vendored at `vendor/trellis` (from
`jayminwest/trellis`; see `vendor/trellis/VENDOR.md` for provenance). It imports
the `bun:` protocol, so it runs under bun, not node. The project installs bun as
a devDependency (`node_modules/.bin/bun`).

## Usage

Run it through the project scripts:

```bash
npm run trellis -- --help
npm run audit                         # audit the current workspace
npm run audit -- src --json           # note: -- is needed after `audit`
```

Or use the helper script — it resolves the vendored checkout and a bun runtime,
and forwards all args:

```bash
S=.pi/skills/trellis-audit/scripts/trellis.sh

# Audit the current workspace (human-readable)
bash "$S" audit .

# Machine-readable and/or saved
bash "$S" audit src --json
bash "$S" audit . --md --out /tmp/trellis-after.md

# Compare two saved artifacts (no re-audit); policy in trellis.yaml gates it
bash "$S" compare before.json after.json

# Task guidance bundled with the tool (writes nothing, starts no audit)
bash "$S" guide cleanup

# Other surfaces
bash "$S" drift <repo-path>     # canonical-config drift only
bash "$S" fleet                 # audit every target in targets.yaml
bash "$S" report                # history dashboard (needs --history runs)
bash "$S" standards             # canonical manifest + versions
```

Override discovery with `TRELLIS_DIR` (checkout root) or `TRELLIS_BUN`
(bun executable) when the layout moves. Without the helper, invoke bun directly:

```bash
node_modules/.bin/bun vendor/trellis/src/cli/main.ts audit .
```

## Reading a report

1. **Sloppiness index** — the headline 0–100. Lower is better; infrastructure
   cannot offset it. `completeness:` tells you whether analysis was complete.
2. **Score contributions** — which metrics produced the index. Each line names
   the raw metrics behind the points, so a score is always traceable.
3. **Hotspots** — ranked leads (e.g. `complexity.hotspot`,
   `duplication.clone-group`) with `file:startLine-endLine`, cyclomatic
   complexity (`CC`), erosion mass, and nesting depth. Treat these as
   investigation prompts, not a mandate.
4. **Metrics** — raw measurements split by source set (`production` / `test`).
5. **Safeguards** — configuration evidence only (hooks, lint/typecheck/test
   scripts, coverage budgets). Never folded into the score.

Use `--json` for detail omitted from the terminal summary.

## JavaScript specifics

- The native audit includes `.js`, `.mjs`, and `.cjs` and parses them as
  JavaScript; CommonJS `require()` calls are recorded as edges.
- **JSX/TSX is unsupported** in this checkout, and dynamic import targets stay
  unresolved. Those show up as missing graph evidence, not as clean code.
- Direct `require` calls assume the loader name is not shadowed.
- The upstream tool targets TypeScript workspaces; the JS support here is the
  local conversion.

## Cleanup workflow

Use the tool to keep a before/after record:

```bash
S=.pi/skills/trellis-audit/scripts/trellis.sh
mkdir -p .trellis-artifacts
bash "$S" audit . --json --out .trellis-artifacts/before.json
# ... make one bounded, behavior-preserving change ...
bash "$S" audit . --json --out .trellis-artifacts/after.json
bash "$S" compare .trellis-artifacts/before.json .trellis-artifacts/after.json
```

Rules of thumb:

- Pick one coherent hotspot; make small changes and re-audit.
- Prefer removing duplication, clarifying responsibility, or simplifying
  dependency direction.
- Do **not** add indirection just to move a number.
- Stop when the remaining findings have no clearly justified improvement, and
  say what remains.

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Clean |
| `2` | A policy in `trellis.yaml` tripped (max index, budget, regression, `failOnNew`). Report still prints to stdout; reasons go to stderr. |
| `1` | Operational error (bad flags, unreadable config, incompatible compare) |

That split lets CI distinguish "failed the bar" (`2`) from "tool broke" (`1`).

## Configuration (`trellis.yaml`)

Optional; defaults are sane. Discovered at the workspace root, or pass
`--config`. It only holds meaning for failure policy and source selection — it
never changes scoring weights.

```yaml
source:
  exclude: ["src/generated/**"]
  classify:
    "scripts/tools/**": "test"
policy:
  maxIndex: 40
  regression:
    maxIncrease: 2
    maxIncreasePercent: 10
  budgets:
    duplication.density.production: { max: 0.05 }
  failOnNew: [import-cycle, complexity.hotspot]
```

## Optional evidence providers

`--provider <id[:mode]>` adds advisory, **unscored** evidence alongside the
native measurement (never changes the index). Supported ids: `jscpd` (needs a
mode: `exact|normalized|near`), `dependency-cruiser`, `knip`, `sonarjs` (the
latter three resolve to `unsupported` until their adapters ship). The pinned
tool must already be installed where trellis resolves from — it never installs
or fetches tools at audit time. `policy.requireEvidence` turns a
required-but-missing provider into exit `2`.

## Gotchas

- History is opt-in: `--history` (optionally `--db <path>`); otherwise runs are
  stateless. History defaults to `~/.trellis/trellis.db`, never inside the repo.
- `--out` infers `.json`/`.md` from the extension.
- Audit output goes to stdout, progress/policy reasons to stderr; use `--quiet`
  in scripts and `--verbose` to see per-analyzer progress.
- This checkout is a fork conversion; re-verify commands after updating it.
