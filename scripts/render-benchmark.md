# Render benchmark

Measures one real frame's cost stage by stage, in a hidden Chrome with a real
GPU, and reports the kernel's share of it. It answers "is anything on the kernel
side a render bottleneck" with numbers from a running engine, not from a
structural test.

```sh
npm run bench:render     # measure, write agent-runs/benchmark-results.json and agent-runs/benchmark-report.md
npm run bench:check      # compare the last result against the committed baseline
npm run bench:baseline   # re-record the baseline from a run (only when a change is meant to move it)
```

## What it does

1. Starts a dev server for this checkout, with `test/fixture-project` as the
   project, and a hidden Chrome (`--headless=new`, `--enable-unsafe-webgpu`) with
   a real GPU.
2. Opens the editor, waits for the renderer and the material library.
3. Runs `scripts/render-benchmark-driver.js` inside the page. It builds a
   retro-2D scene, a mid scene and an AAA-ish scene through `world.spawn`, then
   two curves: entities 1 → 100 → 1,000 → 10,000, and added passes 1 → 10 → 50.
4. Reads the kernel's own per-pass costs and drives `loop.step(0)` per frame —
   a stopped clock, so every frame is a settled still frame.
5. Writes the JSON and the report.

## What it reports

- Total frame time, split into plugin frame systems, entity sync, and the draw.
- Kernel stages: entity sync, the `frame` pass's setup, the graph executor's own
  bookkeeping, and the draw's tail.
- Every pass's `extract`, `prepare` and `execute`, by pass name, from the graph
  executor's own timing. The pass curve prices the clock reads that timing makes.
- `stats`, the target pool's `created`, and the JS heap.

## What it cannot report

- Per-pass GPU time. three exposes one whole-frame timestamp, not one per pass.
- A pure GPU counter. The barrier number waits for the card but includes the CPU
  time between submits.

## The baseline

`scripts/render-benchmark-baseline.json` holds the measured kernel share per
scene, the entity sync at 10,000 entities, and the executor's overhead at 50
passes, with a stated tolerance. `npm run bench:check` fails when a run goes past
them. It is not in `npm run check`, because it needs a browser; both are listed
under a deliberate refusal rather than a slow default.

## Files

- `render-benchmark.mjs` — the node harness: processes, the browser, the report.
- `render-benchmark-driver.js` — the page half, evaluated inside the editor.
- `render-benchmark-report.mjs` — the Markdown report.
- `check-render-benchmark.mjs` — the regression check.
