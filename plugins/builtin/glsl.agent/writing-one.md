# Writing a GLSL shader of your own

Add an entry to `GLSL_SHADERS` in `glsl/builders.js`, or call
`context.glsl.register` from your game's own plugin. Both take the same
definition: `parameters`, `inputs`, `source`, and optionally `material`, `base`,
`output` and `kind`.

Write the source as one function of declared arguments. It cannot read a
uniform, an attribute or a varying of its own — the renderer generates the
shader stage, and that stage carries skinning, instancing, fog, shadows and both
UV sets. GLSL is inserted into it. Anything the function needs arrives through
`inputs`.

## Engine facts a GLSL shader has to know

- **Ask for a UV set by name.** `uv.face` is 0 to 1 across the face, for a
  border, a radial falloff or a ramp. `uv.metres` is one unit per metre of
  surface, for a pattern that must stay one size whatever it is drawn on. There
  is no third set and no way to ask three directly.
- **`time` is the only clock.** It is the fixed step, so the same second always
  looks the same and a headless run and a browser agree.
- **Additive blending already multiplies by alpha.** Put the shape in the RGB
  and return alpha 1. Alpha carrying the shape as well squares every soft edge.
- **A name is claimed once.** Registering a name another language also uses is
  the point — that is a second implementation of the same shader. Registering a
  name Materials already owns replaces it, and `register` says so.
- **Bloom is not on unless the level asked for it** in `world.post`. A shader
  gets no bleed for free: build the falloff in. A hot core, a soft shoulder,
  white only at the brightest part.

## GLSL facts that cost time here

- **Helpers go above `#pragma main`.** Three parses the first function it finds
  as the shader itself, so a noise helper written first becomes the shader.
- **`pow(x, y)` with a negative `x` is undefined.** Square by multiplying.
- **Integer and float do not mix.** `1` is not `1.0`, and `float * int` will not
  compile.
- **`fwidth` is how a line stays one pixel wide.** Threshold against it or the
  line crawls at distance.
- **No sampler arguments.** Ask for `texture` instead: it arrives already
  sampled at `uv.face`, and white where the mesh has no texture.
- **No backtick anywhere in the source, comments included.** It is written in a
  template literal, so one backtick ends the string and the whole plugin fails
  to import. `snapshot --plugins` names the file and the syntax error.
- **A hash is 0 to 1; three's noise is signed.** `mx_noise_float` and
  `mx_fractal_noise_float` return roughly minus one to one, and a
  `fract(sin(dot(…)))` hash returns 0 to 1. Summing an unsigned hash for a
  fractal never reaches below half, so anything cut against it never crosses
  the cut and the shader draws solid. Make each octave signed —
  `(noise(p) * 2.0 - 1.0)` — and centre the total at the end.
- **A hash is flat, gradient noise is not.** `mx_noise_float` in TSL stays near
  zero and rarely passes a threshold; a `fract(sin(dot(…)))` hash is spread
  evenly over its range. Copying a TSL threshold into GLSL fires several times
  as often, which is why the GLSL hologram cuts at 0.94 where the TSL one cuts
  at 0.62. And hash per row, never `noise()`: a smoothed value interpolates
  between whole numbers, so neighbouring rows tear together in wide blocks.

## Filling more than one slot

A shader needing a colour and an added light is two functions, not one. Both
evaluate any maths they share, so keep the shared part small, and put a shared
FUNCTION in `helpers` — two slots declaring one name will not compile.

`dissolve` is the worked example: `colour` carries the body with the burn as its
alpha, `emissive` carries the hot line at the cut, and the fractal noise both
need is declared once in `helpers`.

`grass` is the worked example of a `vertex` slot. Filling it replaces the
renderer's own projection, so the matrices arrive as arguments and the
clip-space position is worked out in the shader.

## Proving it draws

GLSL compiles on the WebGL backend only, and nothing compiles headless, so the
proof is a real frame:

```sh
node bin/engine.mjs run glsl.backend          # says whether it can build at all
node bin/engine.mjs run glsl.forceWebGL true  # then reload the page
node bin/engine.mjs run shader.list           # which language each shader is built from
node bin/engine.mjs run see.capture '{"subject":"<id>"}'
```

A compile failure is reported by the backend in the browser console, against the
generated shader rather than your source, so read the function name in the error
to find which one failed.
