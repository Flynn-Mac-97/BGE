## Reading

The numbers here are from the committed run; the tables above are regenerated and
this section is committed, so re-running refreshes the figures and keeps the
argument. The page's clock is quantised to 0.1 ms, so a share quoted from a frame
under a millisecond is a direction rather than a decimal.

**The kernel is not the bottleneck at AAA scale.** On 2,500 meshes that cannot
merge, under a shadow-casting light, with a real post chain and 16 extra
full-scene passes, the kernel stages are 0.4 ms of a 12.5 ms frame — 3.2%. The
draws dominate: `post` alone is 1.5 ms, and each of the 16 extra passes is
0.2–0.3 ms. The executor's own bookkeeping is 0.1 ms of that, and it stays 0.1 ms
at 1, 10 and 50 added passes: the kernel's per-frame work is the pass count, not
what the passes contain.

**The walk is the bottleneck on a frame that draws almost nothing.** Three
thousand lambert meshes merge into 3 batches and 6 draw calls, so the scene draws
in 0.2 ms — and the walk that feeds those batches is then most of the frame.
Better batching makes the walk's share larger, because batching removes the
passes' cost and leaves the walk's. That is the engine's own `stats` reporting
the merge working (`merged: 3000, batches: 3`), not a measurement artifact. The
kernel's own stages are not the cost here; the walk is, and the walk is the scene
pass's `extract`.

**The entity walk is the largest per-frame stage, and it is linear.** At 10,000
entities the world merges to about a dozen batches, the frame is 1.8 ms, and the
scene pass's `extract` is 1.1 ms of it — the single largest stage once the walk is
counted as pass work rather than kernel work. Its per-entity cost is flat, about
0.1 µs at both 1,000 and 10,000 entities, so ten times the world costs about ten
times the walk, never a hundred. This is the cost the render-graph design moved
out of the kernel: a plugin that replaces the scene pass does not pay it, and the
kernel's fixed stages are the pass count instead.

**A walk share that falls as the passes draw more.** The guarded per-scene share
is the scene pass's `extract` — the entity walk — because the kernel's own stages
now sit at the page clock's floor, and a share of the frame would say nothing
about them. The walk is a fixed per-entity cost, so the more the passes draw, the
smaller its share: the AAA frame is mostly GPU and passes, and the walk is a few
percent of it. The metric used to be `kernelShare`, which counted the walk with
the kernel; the walk moved into the pass, so the metric followed it.

### What the numbers showed beyond the expectation

- **Batching turns the frame into the walk.** The engine's batching is good
  enough that a 3,000-entity frame draws in 6 calls. The walk that feeds those
  batches does not get cheaper with the batch count, so it becomes the largest
  stage. The fix was not the loop shape — it is already one visit per entity,
  proved headless by `test/core/render/entity-sync-cost.test.mjs` — but moving
  the walk into the scene pass's `extract`, which is what this round did: the
  kernel no longer walks, and a plugin that replaces the scene pass skips it.
- **The target pool costs nothing to add passes to.** Fifty added passes that
  each write a half-resolution transient create exactly one `RenderTarget`: the
  table's `targets` column is 1 for the 50-pass scene and 1 for the AAA scene.
  The aliasing by live span is doing its job.
- **The Lights plugin's lookup was the largest single per-frame cost, and is now
  O(1).** `syncLights` calls `markShadowSurfaces` every frame, and that walks
  every scene child and calls `world.byId` on each — which was a scan of the
  entity list, so the walk grew with the square of the world. The world keeps an
  id index now: the same walk measured 0.3 ms against 7.1 ms before, and
  `test/core/world/lookup.test.mjs` proves each lookup makes one index probe, at
  eight and at four thousand entities.
- **The page's clock is coarse.** Chrome clamps `performance.now()` to 0.1 ms on
  a page that is not cross-origin isolated; the harness measures the quantum and
  the environment table states it. The retro and mid rows are a handful of
  quanta each; the 1,000- and 10,000-entity rows and the pass curve are far
  above it, and the headless test proves the walk's shape exactly with no clock
  at all.

### GPU against CPU

three's whole-frame timestamp is available (the backend is WebGPU and the
feature is present). On the AAA scene the card's time is about 10 ms against a
12.5 ms CPU frame, so the card's work is comparable to the whole frame. On the
retro and mid scenes the card's time is under 0.1 ms against 0.9–1.0 ms CPU
frames, so those are CPU-bound, and the kernel's share there is real CPU cost
rather than a thread waiting on the card.

There is no per-pass GPU time. three exposes one whole-frame timestamp, not one
per pass, and the WebGL 2 disjoint-timer extension — present on this machine —
belongs to the WebGL backend the engine did not use. The pass table is CPU time
only; a per-pass GPU number needs either the WebGL path or a timestamp per pass
from three.
