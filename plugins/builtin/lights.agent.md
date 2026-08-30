# Lights

- A light is an **entity**, `type: "light"`, placed in the level like anything else. The type is registered here, not by a file in `types/`, so it never appears in the Project panel and cannot be dragged in — type it into the level or use `run place.at`.
- Five kinds: `point` `spot` `directional` `area` `hemisphere`.

```json
{ "type": "light", "id": "lamp", "at": [4, 3, -2],
  "properties": { "kind": "point", "color": "#ffb060", "intensity": 2.4,
                  "range": 12, "decay": 1, "shadow": false } }
```

Every property, with its default:

| key | default | read by |
|---|---|---|
| `kind` | `"point"` | all — an unknown kind is reported and falls back to point |
| `color` | `"#ffffff"` | all |
| `intensity` | `2` | all |
| `range` | `10` | point, spot: metres to nothing, `0` never falls off. **Directional: this sizes the shadow camera, half either side — it is not a falloff** |
| `decay` | `1` | point, spot. Three's own default is 2; this engine uses 1 so a level author's number means what they expect. `decay: 2` under intensity 4 reads as black a few metres out |
| `direction` | `[0,-1,0]` | spot, directional, area. **The direction light TRAVELS** |
| `angle` | `45` | spot only, degrees, half the cone |
| `penumbra` | `0.3` | spot only |
| `width` `height` | `2` `1` | area only, metres. An area light only reaches `standard` and `physical` materials — over the default lambert it does nothing |
| `groundColor` | `"#3a3f46"` | hemisphere only. A hemisphere light's position is not read |
| `shadow` | `false` | opt in, one at a time |
| `fade` | `0` | seconds to fade over, after which the entity destroys itself |
| `static` | `true` | only affects what `lights.bake` lists |

- **One shadow. `SHADOW_CAP` is 1**, and it is a constant rather than a setting. A directional or spot shadow is a second render of the map every frame; a point light's is six. Map is 1024², so a directional light's texel is `range / 1024` metres — at `range: 96` that is 9 cm. A prop smaller than a few texels casts nothing at all.
- **`mesh: { shadow: false }` on a placement or a type casts nothing and still receives.** Anything flat and lying on the ground needs it: a mown patch, a rut, a scorch mark is a thin box, and a thin box under a low sun throws a hard offset shadow of its own outline across the surface it is meant to be part of.
- **Aim a shadow-casting key from the SIDE.** Aimed away down the view axis it throws every shadow directly behind the thing that cast it: full cost, nothing visible.
- `world.sun` in the level's `world` block is a separate directional light that **cannot cast a shadow**. Use it as fill and make the light entity the key.
- Also reads the level's top-level `lightmaps` block, and writes `mesh.lightmap` onto the entities it names. Nothing here bakes — `run lights.bake '{"surfaces":true}'` emits the manifest for an external bake.
- `lights.list` · `lights.bake` · `lights.flash`. Check warnings in `errors`.
