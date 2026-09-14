---
description: Shaders written as GLSL source — one function per slot, its arguments bound to engine inputs by name. Use when writing or changing a shader, when a GLSL shader draws nothing, and to check which backend is drawing.
---
# GLSL

- **One of the two languages a shader can be written in**; TSL is the other.
  A shader is **one function per slot**, its arguments bound by name to things
  the engine already has.
- **It builds on the WebGL backend only** — three inserts the source into the
  shader it generates and the WebGPU backend generates WGSL. WebGPU is the
  default, and there each shader draws in TSL when it is also written in TSL.
  `glsl.forceWebGL true` and a reload choose WebGL for a GLSL-only shader.

```js
context.glsl.register('scanner', {
  parameters: { glow: '#54f0d0', speed: 2 },
  inputs: { face: 'uv.face', clock: 'time', glow: 'colour:glow', speed: 'number:speed' },
  source: `
    vec4 scanner(vec2 face, float clock, vec3 glow, float speed) {
      return vec4(glow * fract(face.y - clock * speed), 1.0);
    }`
})
```

## Slots

`colour` `vec4` (the surface, alpha included — the default) · `emissive` `vec3`
· `opacity` `float` · `vertex` `vec4` (a clip-space position; you project it).

One slot is `source` + `inputs` + `output`; several are `outputs: { colour:
{source, inputs}, … }`, and a function they share goes in `helpers` — the detail
file says why.

## Inputs

| written | is |
|---|---|
| `uv.face` · `uv.metres` | `vec2`: 0 to 1 on the face · one unit per metre |
| `time` | `float`, the fixed clock. The only clock a shader may read |
| `normal` · `viewDirection` | `vec3`: view space · towards the eye |
| `position.world` · `.local` · `.geometry` | `vec3` |
| `cameraPosition` | `vec3`, the eye |
| `matrix.projection` · `.view` · `.model` | `mat4`, for a `vertex` slot |
| `quad.wide` · `quad.tall` | `float`, the quad's declared size |
| `screen` · `tint` | `vec2` pixels · `vec3` the mesh's colour |
| `texture` | `vec4`, **already sampled** at `uv.face`; white where none |
| `colour:<key>` · `number:<key>` | `vec3` · `float` |
| `declared:<key>` | `float`, 1 where the level wrote that key, else 0 |
| `given:<key>` | a node the painter passed. Programs only |

An unknown input is reported by name; the argument gets zero.

## The rest

- `material` — `transparent`, `depthTest`, `depthWrite`, `side: 'double'`,
  `blending: 'add'`, `alphaTest`. Opaque front faces by default.
- `base` — `basic` (default, unlit), `lambert`, `standard`.
- `kind` — `material` (default), or `program` with `output: 'node'`.

## Two source rules

- **Helpers go above `#pragma main`.** Three reads the first function it finds
  as the shader.
- **No backtick anywhere, comments included.** The source is a template literal
  and one ends it. The other GLSL traps are in the detail file.

## Commands

- `glsl.backend` — whether GLSL can build now, and why not if not.
- `glsl.forceWebGL '[true]'` — choose WebGL on the next load; `'[false]'` goes back to WebGPU.
- `glsl.list` — every GLSL shader, its slots and defaults.
- `glsl.source '["dissolve"]'` — the helpers and slots of one.

## Detail

- `plugins/builtin/glsl.agent/writing-one.md` — the engine facts a GLSL shader
  must know, and how to prove one draws.
