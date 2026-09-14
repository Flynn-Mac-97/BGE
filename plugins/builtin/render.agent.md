---
description: How the frame is rendered — tone mapping, exposure, environment light, shadow quality and backend, all in one table. Use when a scene looks flat, washed out, too dark or like generic 3D, when dialling in a game's look, and before changing any render setting.
triggers: render, look, tone mapping, exposure, environment, hdri, shadows, washed out, flat lighting, premium
---

# Render

Every render setting is in one table: `plugins/builtin/render/settings.js`.
Read what is set now, with where each value came from:

```sh
node bin/engine.mjs run render.look
```

## Where the settings are written

```json
game.json            "render": { "toneMapping": "neutral", "exposure": 0.9 }
levels/<name>.json   "world": { "render": { "exposure": 0.7 } }
```

Lowest to highest: default → game → level → session. Every edit to either file
is live.

## The settings

| key | options | 3D default |
|---|---|---|
| `profile` | auto, 3d, 2d | auto |
| `toneMapping` | neutral, agx, aces, reinhard, none | neutral |
| `exposure` | 0.05 to 8 | 0.9 |
| `environment` | room, none, or a `.hdr` / `.exr` path in assets | room |
| `environmentIntensity` | 0 to 10 | 0.4 |
| `environmentBlur` | blender, three | blender |
| `reflections` | room, sky | room |
| `shadows` | soft, smooth, sharp | soft |
| `shadowSize` | 512, 1024, 2048, 4096 | 2048 |
| `globalIllumination` | off, screen | off |
| `globalIlluminationStrength` | 0 to 4 | 1 |
| `globalIlluminationQuality` | low, medium, high | low |
| `readability` | on, off | on |
| `antialiasing` | level, temporal | level |
| `backend` | webgpu, webgl (needs a reload) | webgpu |

`environmentBlur: blender` corrects three's environment blur, which reflects
every roughness about 0.1 too sharply. Measured against Cycles on test spheres;
the curve is in `render/environment-blur.js`. Direct light already matches and
is not changed. Set `three` to compare, or when three fixes its blur.

`reflections: room` captures the level into the environment about 12 frames
after it loads, and again after every edit to game.json or the level. Loaded
models are left out of the capture. Without it, environment light passes
through walls and floors, and cloth in shade looks wet. `render.look` reports
`roomProbe`.

`antialiasing: temporal` adds Post Processing's `traa` after any lighting
effect and drops `smaa` from the chain. Use it for hair cards, dithered alpha
and SSGI grain.

`globalIllumination: screen` adds Post Processing's `ssgi` effect at the front
of the chain. It adds bounce light only and darkens nothing, so keep `ssao`,
the room probe and baked occlusion for blocked light. Strength 1 matched Cycles
in a white room with a red wall; `quality: low` matched as well as `high`. It
costs about 1 to 3 ms on a 1148×622 frame, and sees only what is on screen.

`readability: off` removes the arcade aids the renderer draws over the lighting:
the dark outline round moving things, the soft dark oval under them, and the
ring round the followed one. Use it for a realistic look; the oval otherwise
reads as a dark smudge on a lit floor.

**`auto` picks 3d when the level has any mesh.** A sprite-only level gets the 2D
defaults — no tone mapping, no environment — so a 2D game's colours stay exactly
as drawn.

## Commands

- `render.look` — every setting, its value, where it came from, its options.
- `render.set '{"exposure":0.8}'` — writes game.json.
- `render.set '{"exposure":0.8,"save":"level"}'` — writes the open level.
- `render.set '{"exposure":0.8,"save":false}'` — this session only.
- `render.reset` — drops session values.

A bad value is refused before anything is written.

## Dialling in a look

1. `render.look` to read the current values.
2. Try values with `"save":false` and look at a frame.
3. Write the chosen values with `render.set`.

Changing `environment` or `toneMapping` also changes how bright World Look's
ambient and sun feel. A scene lit by an environment usually wants a lower
`world.ambient`.

## Switching it off

`plugins.enable '["Render", false]'` puts three back the way the engine starts.
Switching it on applies the settings again. No reload.

## What it owns and what it does not

It owns how the frame is rendered. The sky is Skybox, fog, ambient and sun are
World Look, the effect chain is Post Processing, and lights are Lights.

## Detail

- `plugins/builtin/render.agent/choosing.md` — why the defaults are what they
  are, and what each tone mapping and shadow option costs.
