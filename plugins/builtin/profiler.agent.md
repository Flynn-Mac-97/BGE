---
description: Measures what a frame costs, on the thread and on the card, over frames drawn back to back rather than at the screen refresh. Use before and after a rendering change, to find what a material or an effect costs, and to answer how many of a thing the engine can draw.
---

# Profiler

- `profile.frames` draws many frames as fast as it can and reports what they
  cost. Not on the animation frame: that is capped to the screen's refresh, so a
  scene with four hundred frames a second of headroom and one with none both
  measure the same.
- **Two numbers, two questions.** `cpu` is how long this thread spent describing
  the frame — draw calls, and the work `sync` does per entity. `gpu` is how long
  the card spent on it — pixels, and how heavy a shader is.
- `gpu` is null on WebGL 2. It needs `timestamp-query`, which is a WebGPU
  feature; three turns the tracking off by itself where it is missing.

```sh
node bin/engine.mjs --timeout 90000 run profile.frames
node bin/engine.mjs --timeout 90000 run profile.frames '{"frames":400}'
```

## Run it twice

**Nothing is merged for the first 45 frames after anything in the scene moves.**
A run straight after a level change measures the engine settling and reads two
to three times high. Run it, throw that away, run it again.

## What to expect

Measured on one machine at 1280×720 through WebGPU, steady state, boxes on one
material. Treat the shape as the finding and the numbers as that machine's.

| entities | cpu ms | gpu ms | draw calls |
|---|---|---|---|
| 500 | 1.0 | 0.07 | 5 |
| 2000 | 3.3 | 0.33 | 7 |
| 6000 | 18.8 | 0.46 | 9 |
| 12000 | 45.1 | 3.0 | 11 |

- **The thread is the ceiling, not the card.** CPU grows faster than the entity
  count; GPU barely moves. A 60 frames a second budget of 16.7 ms runs out at
  roughly five thousand entities.
- **Draw calls stay flat** because merging holds them there. Eleven calls for
  twelve thousand boxes.
- **A TSL shader is not a cost worth avoiding.** Every sample shader lands
  within about a third of plain lambert on the thread, and under half a
  millisecond on the card at two thousand of them.
- **An outline breaks merging.** Five hundred outlined entities draw in a
  thousand calls rather than five, because an outlined entity keeps its own
  mesh. Outline the few things a player is looking at.

## Detail

- `plugins/builtin/profiler.agent/reading-the-numbers.md` — what each field
  means, what the harness cannot see, and how to set up a fair measurement
