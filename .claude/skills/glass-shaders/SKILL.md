---
name: glass-shaders
description: The sample shelf of node shaders — fresnel, aura, waves, hologram, dissolve, gradient — written in TSL and registered into the Materials library. Use when a surface needs to move, glow, scan or burn rather than just sit there, and read it before writing a shader of your own.
---
<!-- generated from plugins/builtin/shaders.agent.md at server start; edits are lost -->

# Shaders

- Six sample materials, each a TSL node graph. They register through the same
  door a game's own shader uses — `context.materials.register` — so nothing
  here is a special case, and this file is the worked example of adding a
  seventh.
- Named on a `mesh` like any material, with its keys written **flat** beside
  `texture` and `tint`:

```json
"mesh": { "box": [2, 2, 2], "material": "hologram",
          "glow": "#54f0d0", "lines": 14, "speed": 2 }
```

| name | is | reads |
|---|---|---|
| `fresnel` | light gathering where a surface turns from the eye | `edge`, `power` 2.5, `strength` 1 |
| `aura` | an additive glow that breathes on the engine clock | `glow`, `speed` 1.2, `least` 0.25 |
| `waves` | two crossing sines that **displace** the mesh and shade its slope | `shallow`, `deep`, `height` 0.18, `length` 2.4, `speed` 0.8 |
| `hologram` | scanlines up the object, a rim, and a flicker | `glow`, `lines` 90, `speed` 2, `flicker` 0.12 |
| `dissolve` | burns away over fractal noise with a hot edge | `body`, `edge`, `amount` 0.5, `scale` 6, `border` 0.08 |
| `gradient` | two colours across the surface, at an angle | `from`, `to`, `angle` 0 |

## What they need to read properly

- **`fresnel` needs curved geometry.** A box has one normal per face, so it
  takes one flat shade per face rather than a rim. It is not an outline and
  will not draw one.
- **`aura` is softest at the middle of each face**, so on a box it reads as one
  glow per face rather than one shell around the whole thing.
- **`aura` and `hologram` add their light** to what is behind them. Over an
  empty background they add to nothing and disappear. Give the level a `sky`.
- **`waves` moves vertices**, so it needs a mesh with some to move. A flat slab
  works; a two-triangle quad does not.

## Determinism

Every animated one is driven by `time`, the fixed clock, never a wall clock. The
same second always looks the same, and a headless run and a browser agree.

## Commands

- `shaders.list` — every shader, what it is for, its keys, and whether it can be
  built right now. `buildable` is false in a headless world for all of them,
  which is not a fault: describing a shader needs no renderer.

## Panel

Docked right. Pick a shader to read its keys, then apply it to a mesh selection.

## Adding one

Add an entry to `SHADERS` with its `about` and defaults, then a builder in
`buildersFor`. Describe it in the first place and build it in the second, so a
headless world can still say what it is. Read parameters through `number` and
`colourOf` so a level that writes nonsense gets the default rather than a
broken shader.
