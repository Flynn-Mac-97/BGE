# What a Blender material carries into the engine

glTF holds a fixed material — colour, metal, roughness, normal, emission,
alpha — and image textures. It holds no node graph. So a Blender material
arrives in full only when it reduces to those values.

## Measured, from Blender 5.0.1 through this plugin

| the Blender material | what reached the engine |
|---|---|
| Principled with values: base colour, metallic, roughness | every value, exact |
| Image Texture into Base Color | the texture, embedded in the `.glb` |
| Noise, Voronoi, Colour Ramp, any node graph into Base Color | **nothing. Flat grey** |
| Emission colour and strength | emissive, with `emissiveIntensity` |
| Alpha below 1 | `opacity`, and the material is transparent |

Object names, node names and UVs all survive.

## The two answers to a lost node graph

**Bake it**, when the look never changes:

```json
{ "bake": true, "bakeSize": 1024, "bakeSamples": 16 }
```

The export renders each procedural material's colour to an image, packs it in
the `.glb`, and the result is a normal texture. `blender.import` then reports
`baked` rather than `flatGrey`. Baking uses Cycles and unwraps any mesh with no
UVs, so it costs a render per mesh and it flattens the material — it cannot
follow the camera, the clock or the game.

**Write it as an engine shader**, when the look must move — scanning, pulsing,
dissolving, reacting to play. The Shaders and GLSL plugins own that, and the
shader is attached in the type, not in the `.blend`.

## Why an import says `flatGrey`

Every import names the materials whose colour glTF could not carry. The symptom
otherwise is a model that draws flat grey and looks like a texture that failed
to load, which sends a reader to the wrong half of the problem.

## Baking, the detail

- Only materials whose Base Color is driven by a non-image node are baked.
- Colour alone is baked: the Cycles direct and indirect passes are off, so no
  lighting is burnt in.
- A mesh with no UV layer is smart-unwrapped first. Unused UV space bakes black;
  that area is not drawn.
- The image is packed into the export. No file is left beside the `.blend`.
- Roughness, metal and normal are not baked. Only base colour.
