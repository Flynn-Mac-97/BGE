---
description: The sample shelf of node shaders — edges, grass, aura, waves, hologram, dissolve, gradient — written in TSL and registered into the Materials library. Use when a surface needs to glow, move, scan or burn rather than just sit there, and read it before writing a shader of your own.
---

# Shaders

- Seven TSL node graphs, registered through the door a game's own shader uses —
  `context.materials.register`.
- **Every one reads on a flat quad or one box face.** None needs a curved or
  subdivided mesh.
- **The defaults are the demo.** Name one and it looks right.
- Named on a `mesh`, keys written **flat** beside `texture` and `tint`:

```json
"mesh": { "box": [2, 2, 2], "material": "hologram",
          "glow": "#54f0d0", "lines": 14, "speed": 2 }
```

| name | is | reads |
|---|---|---|
| `edges` | a lit line round every face, light inward, a rim. Not a selection outline: the **Outline** plugin draws those | `edge`, `width` 0.03, `power` 3, `strength` 2 |
| `grass` | a tuft of blades on one quad: faces the camera, bends in two gusts, tapers to a point | `root`, `tip`, `blades` 7, `wind` 0.7, `speed` 1.1, `lean` 0.5 |
| `aura` | a breathing glow with drifting wisps and a white-hot core, added to what is behind | `glow`, `speed` 1.2, `least` 0.35, `detail` 9, `strength` 3 |
| `waves` | five crossing waves per pixel: lit water, sparkle, foam on the crests | `shallow`, `deep`, `foam`, `scale` 0.35, `speed` 0.9, `choppy` 1, `sparkle` 1.2 |
| `hologram` | scanlines, a travelling bright bar, rows that tear sideways, an edge glow | `glow`, `lines` 26, `speed` 2, `flicker` 0.12, `glitch` 0.05 |
| `dissolve` | burns away over fractal noise, wide edge band, white-hot line at the cut | `body`, `edge`, `amount` 0.45, `scale` 1.1, `border` 0.14, `strength` 1.3 |
| `gradient` | an eased, dithered ramp at any angle | `from`, `to`, `mid` (off), `angle` 0 |

## What they need to read properly

- **`aura` and `hologram` add their light** to what is behind them. Over an
  empty background they add to nothing: give the level a `sky`.
- **`waves` measures in metres.** `scale` is waves per metre, so a pool and a
  puddle get the same wave. Flat water: nothing moves the mesh. A sphere's UV is
  one wrap rather than one patch per face, so the size follows the wrap there.
- **`edges` on a sphere** draws the rim, not a line: a sphere has one UV patch,
  so its only border is the seam at the back.
- **`grass` wants a quad and no rotation.** It rebuilds the tuft's centre from
  the quad's declared size, which is what lets a field merge into one draw call
  and still turn one tuft at a time. Stand it at half its own height.

## Determinism

Every animated one runs on `time`, the fixed clock. The same second always
looks the same, and a headless run and a browser agree.

## Commands

- `shaders.list` — every shader, its keys, and whether it can be built now.
  `buildable` is false for all of them headless: describing needs no renderer.

## Panel

Docked right. Pick a shader to read its keys, then apply it to a mesh selection.

## Detail

- `plugins/builtin/shaders.agent/writing-one.md` — how to add a seventh, and the
  four engine facts a node graph has to know first
