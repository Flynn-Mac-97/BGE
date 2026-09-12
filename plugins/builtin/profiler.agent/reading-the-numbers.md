# Reading the numbers

| field | is |
|---|---|
| `cpu` | milliseconds inside `sync` and `draw`, on this thread. Mean, median, worst-in-twenty and worst |
| `gpu` | milliseconds the card reported for the frame. Null where the backend cannot time itself |
| `firstFrameMs` | the first frame of the run. It catches a pending compile or a scene not yet built — but the loop has usually drawn the scene already, so a low number means nothing was outstanding, not that nothing costs anything |
| `frame` | the counters from the last frame: draw calls, triangles, entities, how many merged, batches, keylines, materials |

## Setting up a fair measurement

- **Fill the frame.** A scene covering a twelfth of the screen measures the
  frustum, not the shader. Aim the camera so everything is on screen and large.
- **Run it twice.** Merging takes 45 still frames. The first run measures the
  settling.
- **Change one thing.** Entity count and material at once tells you nothing
  about either.
- **Repeat.** The spread between identical runs is large enough to swamp a
  twenty percent difference. Three runs, take the middle.

## What the harness cannot see

- **The card's timer is grainy.** Numbers land on multiples of about 0.065 ms,
  so anything cheaper than that reads as one tick or as nothing.
- **A hidden tab still draws** but is throttled by the browser. The numbers are
  usable for comparing two runs in the same tab and are not a frame rate.
- **Post-processing is not in `drawCalls`.** The pipeline renders outside the
  path the counter watches, so a chain reports one call whatever it is doing.
  Use `gpu` to judge a chain, not the call count.
- **Nothing here measures the simulation.** This is what drawing costs. What a
  tick costs is the loop's own question.

## Two regimes worth measuring separately

- **Many small things** — what an object costs: draw calls, vertices, and the
  per-entity work `sync` does. This is where the engine's ceiling is.
- **Few things covering the screen** — what a shader costs per pixel. Stack
  screen-covering quads to multiply it. Nothing in the sample shelf is
  measurable at one screen; a dozen layers is still under half a millisecond.
