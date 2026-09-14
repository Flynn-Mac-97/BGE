---
name: glass-render
description: How the frame is rendered — tone mapping, exposure, environment light, shadow quality and backend, all in one table. Use when a scene looks flat, washed out, too dark or like generic 3D, when dialling in a game's look, and before changing any render setting.
---
<!-- generated from plugins/builtin/render.agent.md at server start; edits are lost -->

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
| `shadows` | soft, smooth, sharp | soft |
| `shadowSize` | 512, 1024, 2048, 4096 | 2048 |
| `globalIllumination` | off, screen | off |
| `globalIlluminationStrength` | 0 to 4 | 1 |
| `globalIlluminationQuality` | low, medium, high | low |
| `backend` | webgpu, webgl (needs a reload) | webgpu |

`globalIllumination: screen` adds Post Processing's `ssgi` effect at the front
of the chain. It costs about 0.7 ms at low and 1.7 ms at medium on a 1600×1000
frame. It darkens corners itself, so switch the level's `ssao` off when it is on.

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
