# Materials

- A `mesh` block says how a surface is drawn. `mesh: "wall.png"` is shorthand for
  `{ "texture": "wall.png" }`, and a placement's `mesh` merges over its type's, key
  by key — change the box without restating the surface.
- Structural keys — `box` `quad` `model` `material` `unlit` — pick the shape and the
  material. **Every other key is a parameter handed to that material.**

## One mesh block, in full

```json
"mesh": {
  "box": [4, 3, 0.4],
  "material": "standard",
  "texture": "counter-strike/wall.png",
  "tiling": 2,
  "tint": "#c9c0a8",
  "opacity": 1,
  "metalness": 0.1,
  "roughness": 0.6,
  "normal": "counter-strike/wall-normal.png",
  "normalStrength": 1,
  "lightmap": "maps/brush-12-lightmap.png",
  "lightmapIntensity": 1
}
```

## The shape — one of `box`, `quad`, `model`

| key | shape and unit | absent |
| --- | --- | --- |
| `box` | `[width, height, depth]` in metres | falls back to `collider.box`; neither → a 1 m cube, reported |
| `quad` | `[width, height]` in metres, flat | — |
| `model` | a `.glb` name, e.g. `counter-strike/models/c4.glb` | `box` or the collider stands in until the file arrives |
| `anchor` | `centre` (or `center`) or `feet`, for a model whose origin is not its middle | `centre`; a misspelling is reported and treated as centre |
| `scale` | model only, multiplied by the entity's `scale` | `1` |

## Which material

- `"material": "toon"`, or `"material": { "name": "toon", "steps": 5 }`.
- Absent → `basic` when `"unlit": true`, otherwise `lambert`.
- **Prefer the flat form.** The renderer's shared-material cache keys on every
  non-shape key of `mesh` but never on what is inside `material: { … }`, so two
  meshes differing only inside that object share one material and the second draws
  with the first one's numbers.
- A name nobody registered draws lambert:
  `[render] brush.mesh.material: no material named "tooon" is registered — using lambert`.

## Keys every material reads

| key | shape | default when absent |
| --- | --- | --- |
| `texture` | image name. A bare name — including one with folders, `counter-strike/wall.png` — resolves under `project/assets/`; a name starting `assets/ levels/ types/ behaviours/ tests/ plugins/` is project-relative | none |
| `tint` | `#rgb`, `#rrggbb`, a CSS colour name, or a number | white behind a texture, a stable per-type colour without one |
| `tiling` | a number is repeats **per metre** (`2` on a 12 m wall shows 24); `[u, v]` is absolute repeats **on the face**, whatever its size | 1 per metre for a box, exactly once for a quad |
| `opacity` | 0–1; under 1 switches transparency on | `1` |
| `lightmap` | baked image, read on the second UV set | none |
| `lightmapIntensity` | multiplier on it | `1` |

`texture`, `tint` and `tiling` are read by the renderer, which hands the material a
texture that is already tiled and a colour that is already resolved. `lightmap`
needs a material with a lightmap slot — `matcap` and `pulse` have none and say so.

## The library, and what each one reads

| name | what it is | its own parameters, with defaults |
| --- | --- | --- |
| `basic` | unlit — takes no light at all: a sky face, a lamp, a screen | — |
| `lambert` | the default — diffuse only, cheap and flat, what a lightmapped scene wants | `emissive` none |
| `standard` | physically based | `metalness` 0, `roughness` 0.8, `normal` none, `normalStrength` 1, `ambientOcclusion` none, `ambientOcclusionStrength` 1, `emissive` none, `emissiveStrength` 1 |
| `phong` | a specular highlight without a pbr response | `shininess` 30, `specular` `#111111`, `normal` none |
| `toon` | banded light, with an optional rim outline | `steps` 3 (clamped 2–16), `outline` 0 (0–1), `outlineColour` or `outlineColor` `#000000` |
| `matcap` | one sphere image is the whole lighting model | `matcap` none |
| `water` | scrolling normals, driven by `context.time` so a moment always looks the same | `normal` none, `tint` `#2e6f8e`, `opacity` 0.85, `roughness` 0.15, `metalness` 0.1, `normalStrength` 0.6, `speed` 0.06 m/s, `direction` `[1, 0.35]` |
| `additive` | adds its light to whatever is behind — flames, flashes, holograms | `tint` `#ffffff` |
| `pulse` | raw GLSL, the worked example of a custom shader | `tint` `#39e6ff`, `speed` 0.6, `bands` 1 |

A material ignores a parameter it does not know, so one mesh may carry the keys of
the material it has and the one it is about to be changed to.

## What it refuses, and says

- `[Materials] mesh.material must be a name or { name, … } — got 3` — falls back to
  lambert (or basic under `unlit`). An empty name, or an object with no `name`, is
  reported the same way and keeps its other keys as parameters.
- `[Materials] "reddish" is not a colour lambert.emissive can use — using the default instead`;
  a material's own colours take `#rgb`, `#rrggbb`, a CSS name or a number.
- `[Materials] a matcap material with no "matcap" image has no lighting model to read — it will draw as a flat colour`
- `[Materials] water with no "normal" image has nothing to scroll — it will draw as flat tinted glass`
- `[Materials] missing texture /project/assets/x.png (referenced as "x.png")` for a
  `normal`, `matcap` or `ambientOcclusion` that 404s. This one goes to the console
  alone, not into `problems`.
- `[render] brush.mesh.lightmap: a "matcap" material has no lightmap slot`, and
  `[render] brush.mesh.tint: cannot read colour "reddish"`.
- Every other message is said once and is listed under `problems` by `materials.list`.

## Driving it

- `run materials.list` — the whole library, each one's parameters, whether it is
  `drawable`, what the renderer itself answers to, and every problem so far.
- A game adds its own: `context.materials.register('hologram', ({ mesh, texture, tint, view, parameters }) => material)`.
  It reaches the renderer even if it registers after the level loaded.
- Headless, no builder is ever called and nothing imports three; the library still
  lists with `drawable: false`, which is not a fault.
- Check a surface in a browser frame.
