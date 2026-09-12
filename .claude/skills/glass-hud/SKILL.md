---
name: glass-hud
description: The readouts over live play — score, health bar, ammo, timer — declared in the level and bound to `world.state`. Use when putting a value on screen during play. For a full-screen menu or card, use Screen.
---
<!-- generated from plugins/builtin/hud.agent.md at server start; edits are lost -->

# Heads Up Display

- Declared in the level, not in code, so the readout is visible in the file:

```json
"hud": [
  { "text": "SCORE {score}", "at": [12, 12] },
  { "text": "{coins} LEFT", "at": [-12, 12], "anchor": "top-right" },
  { "bar": "{health}", "max": 3, "at": [12, 34], "size": [90, 8] }
]
```

- `{name}` reads `world.state.name`, the same shared state game code already
  writes to, so a HUD needs no wiring. A missing key reads as `0`.
- Drawn into a sibling 2D canvas over the viewport, not CSS. One scene, one
  coordinate system, and it survives a capture.

| key | meaning |
|---|---|
| `text` | a template. `{name}` is filled from `world.state` |
| `bar` | a template read as a number, drawn as a filled rectangle |
| `max` | what a full bar means, default `1` |
| `at` | `[x, y]` pixels from the anchor corner. Negative measures inward |
| `anchor` | `top-left` (default), `top-right`, `bottom-left`, `bottom-right` |
| `size` | text: point size, default `16`. Bar: `[width, height]`, default `[90, 8]` |
| `color` | fill colour, default white |
| `weight` | font weight for text, default `600` |
| `outline` | the dark stroke behind text, so one HUD reads over sky and cave alike |

## From code

`context.hud.add(item)` appends one for this level, `clear()` drops them all.
Items from the level are in `hud.items`; added ones are in `hud.extra`. Both are
emptied on `level:loaded`.

## What it refuses, and why

- **It draws nothing while editing.** A HUD over the viewport sits on top of
  whatever you are trying to select. `hud.always` overrides that, and
  `hud.toggle` flips it.
- It repaints only when the items, the world state or the viewport size change.
  A HUD that repaints every frame turns 60fps into 40.

## Commands

- `hud.read` — every line as it currently reads, filled from world state. This
  is how a headless run checks the HUD without a picture.
- `hud.toggle` — show the HUD while editing, so a capture can include it.
