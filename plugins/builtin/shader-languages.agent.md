---
description: Which language each shader is written in, which the live backend can build, and the switch that swaps between them. Use when a shader must exist in two languages, when a GLSL or TSL shader draws in the wrong one, and before adding a shader language of your own.
---
# Shader Languages

- A shader is a **name** with one implementation per language. This registry
  picks which implementation draws, from the project's preference and what the
  live backend supports.
- Two kinds go through it:
  - `material` — named on a `mesh`. The chosen implementation is published into
    the Materials registry under the shader's name.
  - `program` — asked for by the plugin that draws it. `particle-colour` is one:
    the particle painter owns the quad and asks only for the look.
- Choice is **per shader**. A shader with no implementation in the preferred
  language keeps drawing in the one it has, so preferring GLSL while three of
  seven are written in it costs nothing.

```js
context.shaderLanguages.describe('scanner', { kind: 'material', parameters: { speed: 2 } })
context.shaderLanguages.implement('scanner', 'tsl', build)
context.shaderLanguages.prefer('glsl')       // the swap
context.shaderLanguages.build('particle-colour', { surface, painted })
```

- `describe` needs no language and no GPU, so a headless run answers what every
  shader is and which languages it is written in.
- `implement(name, language, build)` takes what the renderer hands a material
  builder — `{ mesh, texture, tint, view, uv, parameters }` — or, for a program,
  whatever its painter passes.
- A language says whether it can build: `register(name, { about, supported })`,
  where `supported(backend)` returns true or **the reason it cannot**. The
  reason is the point — a surface that quietly drew in another language says
  nothing about which backend it got.

## Languages that ship

| name | builds on | written by |
|---|---|---|
| `glsl` | the WebGL backend only. **The project's preferred language** | the GLSL plugin |
| `tsl` | both backends — it is the renderer's own language, and the fallback | this plugin |

**TSL cannot be switched off.** `render.js`, the post-processing chain, the id
buffer and the nine plain surfaces in Materials are TSL node graphs, and it is
the fallback for any shader with no GLSL implementation. Preferring GLSL decides
what a SHADER is written in, not what the renderer is built from.

## What a swap does not reach

A material cached by whatever built it is not rebuilt by publishing. `prefer`
emits `shader:swapped` with the list of shaders that moved, and anything holding
a built material must drop it there. The particle painter does.

## Commands

- `shader.list` — every shader, the languages it is written in, and the one it
  will be built from. Null means nothing can build it, which is every shader in
  a headless run.
- `shader.prefer '["glsl"]'` — prefer a language. Returns what moved.

## Panel

Docked right. Pick the preferred language, read why one cannot build, and see
which language every shader is drawing in.
