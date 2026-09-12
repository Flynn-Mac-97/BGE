# Every key

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
