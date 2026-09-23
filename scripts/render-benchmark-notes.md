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

**The kernel is the bottleneck on a frame that draws almost nothing.** Three
thousand lambert meshes merge into 3 batches and 6 draw calls, so the scene draws
in 0.2 ms — and the fixed kernel work is then most of the frame: sync 0.4 ms,
setup 0.1 ms, executor 0.1 ms and the draw's tail, 0.6 ms of 1.0 ms (60%). Better
batching makes the kernel's share larger, because batching removes the passes'
cost and leaves the sync's. That is the engine's own `stats` reporting the merge
working (`merged: 3000, batches: 3`), not a measurement artifact.

**The entity sync is the largest kernel stage, and it is linear.** At 10,000
entities the world merges to about a dozen batches, the frame is 1.8 ms, and the
sync is 1.1 ms of it — 77.8%. Its per-entity cost is flat, about 0.1 µs at both
1,000 and 10,000 entities, so ten times the world costs about ten times the sync,
never a hundred. This is exactly the cost the render-graph design moves out of
the kernel into the scene pass's `extract`, and it is the one kernel number worth
watching.

**A kernel share that falls with pass count.** 22.2% on a 0.9 ms retro frame, 60%
on the batched mid frame, 3.2% on the 12.5 ms AAA frame, 1.7% on the 50-pass
frame. The kernel is a fixed per-frame cost; the larger the passing work, the
smaller its share.

### What the numbers showed beyond the expectation

- **Batching turns the kernel into the bottleneck.** The engine's batching is
  good enough that a 3,000-entity frame draws in 6 calls. The sync that feeds
  those batches does not get cheaper with the batch count, so it becomes the
  largest stage. The fix is not the kernel's loop shape — it is already one
  visit per entity, proved headless by
  `test/core/render/entity-sync-cost.test.mjs` — but whether the kernel should
  walk entities at all, which is what the graph design already proposes.
- **The target pool costs nothing to add passes to.** Fifty added passes that
  each write a half-resolution transient create exactly one `RenderTarget`: the
  table's `targets` column is 1 for the 50-pass scene and 1 for the AAA scene.
  The aliasing by live span is doing its job.
- **The Lights plugin costs more than the whole kernel on the AAA frame**: 6.3 ms
  of 12.5 ms, against the kernel's 0.4 ms. `syncLights` calls
  `markShadowSurfaces` every frame, and that walks every scene child and calls
  `world.byId` on each — a linear scan of the entity list per child. It is not
  kernel-side, but it is the largest single per-frame cost measured here, it
  grows with the entity count, and it deserves its own look.
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
