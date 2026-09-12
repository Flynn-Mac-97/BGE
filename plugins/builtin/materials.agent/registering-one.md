# Adding a surface of your own

```js
context.materials.register('rust', ({ mesh, texture, tint, view, uv }) => {
  const material = new THREE.MeshLambertNodeMaterial({ color: tint, map: texture })
  material.emissiveNode = vec3(1, 0.4, 0).mul(uv.face().y)
  return material
}, { about: 'what it is for', parameters: { flake: 0.3 } })
```

- `mesh` is the whole normalised declaration, so read your own keys straight off
  it. They are written flat, beside `texture` and `tint`.
- `tint` is always a Colour and is what `color` should be. `texture` is the
  resolved map or null. `view` is the camera state.
- `details` is optional and carries `about` and default `parameters`, which is
  what `materials.list` and the panels read.
- Register with `null` for the builder to describe a material a headless world
  can name but not draw. Fill the builder in later.
- **A name is claimed once.** Nine standard names are taken, `water` among them.
  Two plugins claiming one name is settled by load order and the loser is never
  drawn; `register` says so in the console. Pick a free name.

## The two UV sets

**`uv` is a pair of named coordinate sets, and you want one of them by name.**
Reaching for three's own `uv()` gets metres, not the 0 to 1 every shader
tutorial assumes, and the shader is then silently wrong.

| ask for | is | use it for |
|---|---|---|
| `uv.face()` | 0 to 1 across this face | borders, radial falloffs, ramps — anything measured against the face |
| `uv.metres()` | one unit is one metre of surface | a pattern that must stay one size on a puddle and on a lake |

The metres are in the first set because that is the one a standard material
samples, and it is what makes `tiling` a density: one repeat count gives the
same texture size on the 0.4 m end of a wall and on its 12 m face. The 0 to 1
set is the second, and is also the channel a lightmap is read from.

## Write it in TSL

A TSL shader is a JavaScript node graph rather than a string, so it composes, it
carries its own types, and it can be assembled and checked with no GPU. The
Shaders plugin is the worked example — six of them, and
`plugins/builtin/shaders.agent/writing-one.md` is the how.
