---
description: Measures what a frame costs, on the thread and on the card, what a material's pixels cost, and what a fixed step costs system by system. Use before and after a rendering or simulation change, to find what a material, a shader or a physics load costs, and to answer how many of a thing the engine can draw or simulate.
category: engine
---

# Profiler

- `profile.frames` draws many frames as fast as it can and reports what they
  cost. Not on the animation frame: that is capped to the screen's refresh, so a
  scene with four hundred frames a second of headroom and one with none both
  measure the same.
- `profile.steps` simulates many fixed steps and reports what each **system**
  cost, so a slow step names the plugin responsible. It runs headless, which is
  the cheapest way to measure physics. It advances the world; reload the level
  to put it back.

```sh
node bin/engine.mjs --headless --project <path> --level <name> run profile.steps
```
- `profile.fill` stacks quads covering the frame on one material and reports
  what its **pixels** cost. One surface over a twelfth of the screen is too
  cheap for any timer here to see; this is the only way to price a shader.
- **Two numbers, two questions.** `cpu` is how long this thread spent describing
  the frame — draw calls, and the work `sync` does per entity. `gpu` is how long
  the card spent on it — pixels, and how heavy a shader is.
- **`gpu` is reported only where it can be believed.** A WebGL 2 backend claims
  it can time itself and then returns a constant near 1000 ms whatever is drawn.
  Any sample longer than the sampling loop is dropped and `gpuTimingWhy` names
  it. So WebGL has no per-frame GPU time: use `profile.fill`, read
  `wallMsPerFrame`, and subtract the `lambert` baseline from the same run.

```sh
node bin/engine.mjs --timeout 90000 run profile.frames
node bin/engine.mjs --timeout 90000 run profile.frames '{"frames":400}'
node bin/engine.mjs --timeout 180000 run profile.fill '{"material":"aura","layers":64}'
```

## Run it twice

**Nothing is merged for the first 45 frames after anything in the scene moves.**
A run straight after a level change measures the settling and reads two to three
times high. Run it, throw it away, run it again.

## What to expect

Measured on one machine at 1280×720 through WebGPU. The shape is the finding;
the numbers are that machine's. The table is in the detail file.

- **The thread is the ceiling, not the card.** CPU grows faster than the entity
  count; GPU barely moves. A 16.7 ms budget runs out near five thousand
  entities.
- **Draw calls stay flat** because merging holds them there. Eleven calls for
  twelve thousand boxes.
- **A shader's cost is its maths, not its language.** At 64 covering layers,
  `gradient` and `hologram` cost the same in TSL and in GLSL. `aura` does not,
  and the noise is why: TSL's `mx_fractal_noise` costs 12 ms above lambert on
  WebGL where a hash noise costs 3.7 ms. Port a shader and re-measure.
- **An outline breaks merging.** Five hundred outlined entities draw in a
  thousand calls, not five: an outlined entity keeps its own mesh. Outline the
  few things a player looks at.

## Detail

- `plugins/builtin/profiler.agent/reading-the-numbers.md` — what each field
  means, what the harness cannot see, and how to set up a fair measurement
