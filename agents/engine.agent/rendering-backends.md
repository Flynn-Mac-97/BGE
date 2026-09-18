# What the renderer may require

- Drawing goes through three's node renderer. WebGPU where the browser has it,
  WebGL 2 where it does not, chosen during `init()`.
- **Every game must run on both.** Render, node materials, TSL shaders, compute
  and storage buffers all work on either; the WebGL one runs compute through
  transform feedback.
- **Require no optional feature.** `shader-f16`, `subgroups`,
  `float32-filterable`, `clip-distances` and `dual-source-blending` are absent
  on WebGL 2. They buy speed and quality, never capability.
- Ask for one by name: `context.renderer.backend.has('subgroups')`, and keep a
  path that works without it. **Never branch on the backend's name** — the name
  is a guess about what a feature implies, and the feature is the real question.
- A plugin that truly cannot work without a feature refuses and names it. It
  never draws a wrong frame instead.
- `renderStats` reports the backend and the features it got, so the answer comes
  from a terminal rather than a guess.
