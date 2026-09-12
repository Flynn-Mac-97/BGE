---
description: The look of a surface — colour, roughness, metal, texture, transparency, emission. Use when something is the wrong colour or finish, when adding a new surface to the library, or when a texture is not appearing on a mesh.
---
# Materials

- The library of surfaces, and the door a game adds its own through. Named on a `mesh`, on a type or on a placement.
- **Prefer the flat form.** Both are read; the flat one is what the renderer's material cache is keyed on.

```json
"mesh": { "box": [2, 3, 0.4], "material": "toon", "steps": 4, "outline": 0.3,
          "texture": "wall.png", "tint": "#ffffff", "tiling": 1 }
```

Nine ship. The right-hand column is written **flat on the `mesh`**, beside `texture` and `tint`:

| name | is | its own parameters |
|---|---|---|
| `basic` | unlit — a sky face, a lamp, a screen. `unlit: true` means exactly this | — |
| `lambert` | **the default** — diffuse only, cheap and flat | `emissive` |
| `standard` | physically based | `metalness` 0, `roughness` 0.8, `normal`, `normalStrength` 1, `ambientOcclusion`, `ambientOcclusionStrength` 1, `emissive`, `emissiveStrength` 1 |
| `phong` | a specular highlight, cheaply | `shininess` 30, `specular` `#111111`, `normal` |
| `toon` | banded light, with an optional rim outline | `steps` 3, `outline` 0, `outlineColour` `#000000` |
| `matcap` | the whole lighting model baked into one sphere image | `matcap` |
| `water` | scrolling normals on `context.time` | `normal`, `roughness` 0.15, `metalness` 0.1, `normalStrength` 0.6, `speed` 0.06, `direction` `[1, 0.35]` |
| `additive` | adds its light to what is behind it — flame, muzzle flash, hologram | — |
| `pulse` | a shader rather than a surface | `speed` 0.6, `bands` 1 |

`opacity` (default 1) applies to all and sets `transparent` below 1. An unknown name is reported and falls back to lambert.

Three things that cost real time:

- **`tint` MULTIPLIES its texture.** It can only darken or shift a hue; a surface lighter than its texture needs a lighter texture. `#ffffff` means "as painted", and an untextured mesh with no tint gets a stable per-type colour.
- **`mesh` merges into the type key by key**, so a `tint` on a type is not a fallback — it multiplies into every textured placement that did not override it.
- **`tiling` is a DENSITY.** `tiling: 2` is two repeats per metre and stays the same size on every face of any box; `tiling: [3, 1]` is three across and one up on the face, whatever its size. A box defaults to once per metre, a quad to its picture exactly once.

Textures are bare paths under the project's `assets/`: `meadow/grass.png` → `<project>/assets/meadow/grass.png`. A missing one falls back to a flat colour **and reports itself**.

Adding your own goes through `materials.register`. Read the detail file first — **three's `uv()` is in metres here**, and a shader that assumes 0 to 1 is silently wrong.

## Detail

Read only the file your task needs.

- `plugins/builtin/materials.agent/registering-one.md` — `register`, the two UV sets, and writing a shader in TSL
- `plugins/builtin/materials.agent/not-materials.md` — the keyline, the contact shadow and the ground ring
