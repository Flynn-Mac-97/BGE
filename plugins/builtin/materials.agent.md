---
description: The look of a surface — colour, roughness, metal, texture, transparency, emission. Use when something is the wrong colour or finish, when adding a new surface to the library, or when a texture is not appearing on a mesh.
---
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

## Not materials: the keyline, the contact shadow and the ground ring

Three groups of keys on `mesh` are read by `engine/render.js`, not by any
material, because each draws a second piece of geometry and a material builder
returns one material. All work on a `box`, on `parts` and on a `model` — a GLB
keeps its file's own materials and can still be given a keyline.

All three are drawn in the SCENE, so a frame taken with `ui: false`, at a stated
`size`, or by a tab in the background still carries them. Anything a player must
find belongs here, not on the 2D screen layer.

| key | is | default |
|---|---|---|
| `keyline` | a dark line round the silhouette, **in screen pixels**, the same width at every distance | 2.2 for anything that has moved, 0 for the rest |
| `keylineColour` | its colour | `#1d1418` |
| `shadow` | a soft ellipse on the ground: `true`, `false`, or a radius in metres | on for anything that has moved |
| `shadowStrength` | how dark it presses, 0 to 1 | 0.44 |
| `ring` | a coloured band on the floor round the feet: `true`, `false`, or a radius in metres | off, unless the ring rule below names it |
| `ringColour` | its colour | `#4fd8ff` |
| `ringStrength` | how strongly it prints, 0 to 1 | 0.85 |

An entity that has never moved since it appeared gets no keyline and no shadow,
so scenery is left alone; declaring either key overrides that. The answer
sticks, so an enemy that stops to bite keeps both — and a prop dragged in the
editor keeps them until the page reloads.

The ring is not handed out that way. It answers "which one is mine" in a crowd,
so `readability.ring` names ONE actor: `'followed'` — the entity the camera
follows, published by the Game Camera as `view.follows` — or `false`, or an
entity id or type name. There is deliberately no setting for every actor; a ring
on a hundred bodies marks nothing. Name extras one at a time with `mesh.ring`.

A ringed actor keeps its contact shadow. The ring's default radius is 0.85 of
the entity's footprint against the shadow's 0.55, so the band lies outside the
dark ellipse rather than over it, and the ring is drawn 5 mm higher so the
colour wins where they do meet. Dropping the shadow would leave the one actor a
player watches as the only thing in the frame with no contact with the ground.

Change the defaults on `context.renderer.readability`, which also holds
`groundY` (0) and `shadowRange` (1.6 m, the lift over which a shadow spreads and
fades).

`outline` on a `toon` material is a different thing and both can be used at
once: it shades the surface where it turns away from the eye, in metres of
geometry, so it thins with distance. Use `keyline` for readability at play
distance and `outline` for a rim on a near surface.

Four limits worth knowing:

- A model's keyline is traced from the file in its REST POSE, so a limb `pose`
  swings moves inside its own outline. It is a pixel or two on a leg at play
  distance, and it buys one draw call per character instead of one per limb.
- A mesh wound inside out — an inverted hull modelled into the GLB — is left out
  of the keyline. Once a type has `keyline`, that baked hull is dead weight.
- A contact shadow lands on `groundY`, not on whatever surface is under it, so a
  thing above a raised prop drops its shadow on the floor beside it. A ring
  lands there too, and unlike the shadow it does not spread or fade with lift:
  it states a ground position, and one that grew with height would blur it.
- Every shadow is one draw call and every ring is one more, however many there
  are. `renderStats` counts both: `contactShadows` and `groundRings`.

A game registers its own with `context.materials.register(name, ({ mesh, texture, tint, view, parameters }) => material)` and never touches a file under `engine/`. `materials.list` · `run materials.list`.
