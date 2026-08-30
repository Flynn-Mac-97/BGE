---
name: glass-skybox
description: Skybox — Owns `sky` and `skyTexture` in a level's `world` block: a flat colour, or a panorama mapped over a sphere. Nothing here feeds the simulation. The other three keys of that block are World L...
---
<!-- generated from plugins/builtin/skybox.agent.md at server start; edits are lost -->

# Skybox

- Owns `sky` and `skyTexture` in a level's `world` block: a flat colour, or a
  panorama mapped over a sphere. Nothing here feeds the simulation.
- The other three keys of that block are World Look's — fog and the global light —
  and are listed below so one block can be written in one go. One more plugin reads
  it: `world.post` is Post Processing's list of passes.
- `world` is a top-level key of the level file, next to `entities`. Every key in it is optional, and
  a key no plugin claims is read by nobody and reported by nobody.

## The level's `world` block, in full

```json
"world": {
  "sky": "#b6c6d8",
  "skyTexture": "counter-strike/sky.png",
  "fog": [0.011, "#c9c0a8"],
  "ambient": { "intensity": 0.72, "color": "#bdb49f" },
  "sun": { "direction": [-0.45, -1, -0.35], "intensity": 1.5, "color": "#fff1cf" }
}
```

| key | shape | default when absent | owner |
| --- | --- | --- | --- |
| `sky` | `#rgb` or `#rrggbb`, a CSS colour name, or a number | nothing — the page shows through; `#6d7f96` as soon as `skyTexture` is set | Skybox |
| `skyTexture` | one image name; a bare name resolves under `project/assets/` | none, so the flat colour is the whole sky | Skybox |
| `fog` | `0.02` density, `"#8a94a3"` colour, `[density, colour]`, `{ density, color }`, `true` for the defaults, `false` or `null` for none | off. Written at all: density `0.014`, colour `#93a7c4` | World Look |
| `ambient` | `0.6` intensity, `"#93a7c4"` colour, `[intensity, colour]`, or `{ intensity, color }` | `{ intensity: 0.55, color: "#93a7c4" }` | World Look |
| `sun` | `1.2` intensity, `"#fff2d8"` colour, `{ intensity, color, direction }`, or a bare `[x, y, z]` — which on the sun **is** its direction, never `[intensity, colour]` | `{ direction: [-0.4, -1, -0.3], intensity: 0.9, color: "#fff2d8" }` | World Look |

`color` and `colour` are both read on `fog`, `ambient` and `sun`. Fog is
exponential-squared per metre: half of a surface is washed out at `0.83 / density`
metres, so `0.011` is half gone at about 76 m.

Every colour in this block is `#rgb`, `#rrggbb` or a CSS colour name. A four- or
eight-digit hex passes the check here and is then refused by the renderer, which
says `[render] setSky: cannot read colour "#11223344"` and drops it: the sky then
shows nothing, fog falls back to `#8a94a3`, and ambient and sun keep the colour they
already had.

## The sky image

- Mapped over a sphere of radius 100 m centred on the camera, drawn first with
  depth testing off, so it can never occlude anything and never fogs.
- **It must be a full sky**: the image's top edge is the zenith, its vertical middle
  the horizon, its bottom edge the nadir. Hand it a zenith-to-horizon image and the
  horizon band lands under the floor.
- A panorama is wider than it is tall. `skybox.look` warns when the loaded image is
  not, and reports `skySize` and the mapping in force.
- It wraps horizontally and clamps vertically, so the poles do not ring.

## What it refuses, and says

- `[Skybox] "purpleish" is not a colour the sky can use — it is neither a #hex value nor one of the CSS colour names — falling back to #6d7f96`
- `[Skybox] skyTexture must be the name of one image file` for anything that is not a non-empty string.
- `skybox.set` throws `no sky key "fog". One of sky, skyTexture` — fog belongs to `world.set`.
- `skybox.set takes one JSON argument — run skybox.set '["sky", <value>]'` when given a bare string.
- `[Skybox] this renderer has no setSky() — that part of the level's world block was not applied`. Those are said once each.
- `[Skybox] the sky texture "skies/dawn.png" did not load, so the flat sky colour is showing` — `skyBox` then reports `failed` and the next apply tries again, so this line repeats; so does a `world` block that could not be read off disk.

## Driving it

- `run skybox.look` — the resolved sky, `skyBox` (`none` `loading` `shown` `failed`
  `nothing is drawing`), `skySize`, the mapping, what the level `declared`, what
  changed this session, and notes. It waits for the level's block to be read off
  disk; reading `context.skybox.report()` directly may answer with the defaults.
- `run skybox.set '["skyTexture", "sky.png"]'`, or a whole block
  `'{"sky":"#6d7f96","skyTexture":"sky.png"}'`. `null` as the value drops the change
  back to what the level said.
- Changes are for this session only — nothing is written, and the next level load
  drops them.
- `world.look` and `world.set` answer for the whole block and route the two sky keys
  here, so either command works.
- Headless, the sky is resolved and reported but no image is loaded. Check a sky in a
  browser frame.
