# Where the passes run

The composer is not in this plugin. `renderer.passes.set(list)` takes an
ordered list and has no opinion about what the passes do.

The renderer owns the GL context, the render targets, the resize, and the
`RenderPass` at the front. It has to: the engine switches between an
orthographic and a perspective camera and only the renderer knows which is
drawing.

Everything after that first pass belongs to this plugin — the effects the level
asked for, in the order it wrote them, and an `OutputPass` to close the chain.

That last pass is not optional and is not the renderer's job. A composer works
in linear light, and without a final tone-map-and-encode step the picture
reaches the canvas unencoded and every colour comes out wrong.

## Reading what is actually built

`context.post` carries the state:

| field | is |
|---|---|
| `declared` | the level's `post`, exactly as written |
| `chosen` | what `post.chain` picked this session, or `null` |
| `resolved` | the effects after defaults are filled in |
| `built` | how many passes the renderer is holding |
| `status` | `off` when nothing is built |

`context.post.set(chain)` is the same call `post.chain` makes, and
`context.post.report()` is what it returns. A problem is reported once per
session; a reload does not repeat it.
