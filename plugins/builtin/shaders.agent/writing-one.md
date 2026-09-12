# Writing a shader of your own

Add an entry to `SHADERS` in `shaders.js` with its `about`, its `dimension` and
its default `parameters`, then a builder of the same name in
`shaders/builders.js`, taking `({ mesh, texture, tint, view, uv })`. Describe it in the first file and draw it in the second,
so a headless world can still say what it is without loading three.

Read every parameter through `number`, `held` or `colourOf`. A level that writes
nonsense then gets the default rather than a broken graph.

## Four engine facts a node graph has to know

- **Never reach for three's `uv()`.** It is in metres here, not the 0 to 1 every
  tutorial assumes, and a shader that assumes wrong is silently wrong. The
  builder is handed `uv` instead: `uv.face()` is 0 to 1 across the face, for a
  border, a radial falloff or a ramp; `uv.metres()` is one unit per metre of
  surface, for a pattern that must stay one size whatever it is drawn on.
- **Additive blending already multiplies by alpha.** Put the shape in the RGB
  and leave alpha at 1. Alpha carrying the shape as well squares every soft
  edge, and a glow shrinks to a dot.
- **A name is claimed once.** Materials owns nine standard surfaces, `water`
  among them. Registering a name that is taken is decided by load order and the
  loser is never drawn; `register` says so in the console. Pick a free name.
- **Bloom is not on.** Post-processing is off on the node renderer, so a shader
  gets no bleed for free. Build the falloff into the graph: a hot core, a soft
  shoulder, and colour that leaves white for the brightest part only.

## What makes one read as finished

- **Anti-alias in screen space.** `fwidth` on the value being thresholded gives
  a band one pixel wide at any distance, which is what stops a line crawling.
- **Soft edges, not steps.** `smoothstep` where a `step` would alias, unless the
  hard cut is the effect, as it is in `dissolve`.
- **More than one frequency.** One sine reads as stripes. Layered waves or
  fractal noise read as a surface.
- **Somewhere white.** A hot core or a specular highlight is what separates
  light from a coloured wash.
- **Slow and fast together.** A breath on the clock under a fast flicker reads
  as alive; either alone reads as a loop.

## Proving it

`node agent-runs/.../build-shaders.mjs` style script assembles every graph with
no renderer and catches type errors — a plain number where a node was wanted is
the common one. Assembling is not compiling, so finish with a real frame:
`run see.capture` and read it.
