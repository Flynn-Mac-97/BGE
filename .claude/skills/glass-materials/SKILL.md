---
name: glass-materials
description: Materials — The library of surfaces, and the door a game adds its own through. A material is named on a `mesh`, on a type or on a placement. **Prefer the flat form.** Both are read; the flat one is...
---
<!-- generated from plugins/builtin/materials.agent.md at server start; edits are lost -->

# Materials

- The library of surfaces, and the door a game adds its own through. A material is named on a `mesh`, on a type or on a placement.
- **Prefer the flat form.** Both are read; the flat one is what the renderer's material cache is keyed on.

```json
"mesh": { "box": [2, 3, 0.4], "material": "toon", "steps": 4, "outline": 0.3,
          "texture": "wall.png", "tint": "#ffffff", "tiling": 1 }
```

Nine materials ship. Everything in the right-hand column is written **flat on the `mesh`**, beside `texture` and `tint`:

| name | is | its own parameters |
|---|---|---|
| `basic` | unlit, takes no light — a sky face, a lamp, a screen. `unlit: true` means exactly this | — |
| `lambert` | **the default** — diffuse only, cheap and flat | `emissive` |
| `standard` | physically based | `metalness` 0, `roughness` 0.8, `normal`, `normalStrength` 1, `ambientOcclusion`, `ambientOcclusionStrength` 1, `emissive`, `emissiveStrength` 1 |
| `phong` | a specular highlight, cheaply | `shininess` 30, `specular` `#111111`, `normal` |
| `toon` | banded light, with an optional rim outline | `steps` 3, `outline` 0, `outlineColour` `#000000` |
| `matcap` | the whole lighting model baked into one sphere image | `matcap` |
| `water` | scrolling normals on `context.time` | `normal`, `roughness` 0.15, `metalness` 0.1, `normalStrength` 0.6, `speed` 0.06, `direction` `[1, 0.35]` |
| `additive` | adds its light to what is behind it — flame, muzzle flash, hologram | — |
| `pulse` | raw GLSL, the worked example of a custom shader | `speed` 0.6, `bands` 1 |

`opacity` (default 1) applies to all of them and sets `transparent` below 1. An unknown name is reported and falls back to lambert.

Three things that are not obvious and cost real time:

- **`tint` MULTIPLIES its texture.** It can only darken or shift a hue; a surface lighter than its texture needs a lighter texture. `#ffffff` means "as painted", and an untextured mesh with no tint gets a stable per-type colour.
- **`mesh` merges into the type's key by key**, so a `tint` declared on a type is not a fallback — it multiplies into every textured placement that did not override it.
- **`tiling` is a DENSITY.** `tiling: 2` is two repeats per metre and stays the same size on every face of any box; `tiling: [3, 1]` is three across and one up on the face, whatever its size. A box defaults to once per metre, a quad to its picture exactly once.

Textures are named as bare paths and resolve under the project's `assets/`: `meadow/grass.png` → `<project>/assets/meadow/grass.png`. A missing one falls back to a flat colour **and reports itself**.

A game registers its own with `context.materials.register(name, ({ mesh, texture, tint, view, parameters }) => material)` and never touches a file under `engine/`. `materials.list` · `run materials.list`.
