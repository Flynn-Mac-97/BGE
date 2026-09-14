# Reading the numbers

| field | is |
|---|---|
| `cpu` | milliseconds inside `sync` and `draw`, on this thread. Mean, median, worst-in-twenty and worst |
| `gpu` | milliseconds the card reported for the frame. Null where the backend cannot time itself |
| `firstFrameMs` | the first frame of the run. It catches a pending compile or a scene not yet built — but the loop has usually drawn the scene already, so a low number means nothing was outstanding, not that nothing costs anything |
| `frame` | the counters from the last frame: draw calls, triangles, entities, how many merged, batches, keylines, materials |

## What one machine measured

1280×720 through WebGPU, steady state, boxes on one material.

| entities | cpu ms | gpu ms | draw calls |
|---|---|---|---|
| 500 | 1.0 | 0.07 | 5 |
| 2000 | 3.3 | 0.33 | 7 |
| 6000 | 18.8 | 0.46 | 9 |
| 12000 | 45.1 | 3.0 | 11 |

At 64 covering layers, `profile.fill` on the same machine, in milliseconds above
the `lambert` baseline of the same run:

| material | WebGPU, TSL | WebGL, TSL | WebGL, GLSL |
|---|---|---|---|
| `gradient` | 0.00 | 0.03 | 0.00 |
| `hologram` | 0.98 | 0.19 | 0.00 |
| `aura` | 3.67 | 12.07 | 3.70 |

`gradient` and `hologram` are the same maths in both languages and cost the
same. `aura` is not: TSL's `mx_fractal_noise` is three times dearer on the WebGL
backend than the hash noise the GLSL one uses, and the GLSL figure matches what
the TSL one costs on WebGPU.

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

## Reading a fill

`profile.fill` stacks quads that cover the frame on one material, so the pixels
the shader is asked for are the only thing growing.

- **Read the difference, never the number.** Every frame is drawn and then
  waited for, because both backends queue work and return — without the barrier
  a heavy shader reads FASTER than a cheap one, since the thread waits less per
  submission. The barrier costs a fixed 2 to 4 ms a frame. Measure `lambert` in
  the same run and subtract it.
- **Never compare two backends' fill numbers.** Their barriers cost differently:
  WebGPU waits on a queue promise, WebGL reads a pixel back. Compare each
  against its own `lambert`.
- **Check it scaled.** Run 16 layers and 64. If the cost did not roughly
  quadruple, the fill is not reaching the shader and the number is noise.
- **The quad size is computed, not guessed**, from the camera three is drawing
  with, and reported as `quad` with the `sizedFrom` camera kind. A fill smaller
  than the frame measures the frustum.
- The stack is spawned and removed, so the level is as it was. It warms 60
  frames first, above the renderer's 45-frame merge settle.

## Two regimes worth measuring separately

- **Many small things** — what an object costs: draw calls, vertices, and the
  per-entity work `sync` does. This is where the engine's ceiling is.
- **Few things covering the screen** — what a shader costs per pixel. Stack
  screen-covering quads to multiply it. Nothing in the sample shelf is
  measurable at one screen; a dozen layers is still under half a millisecond.
