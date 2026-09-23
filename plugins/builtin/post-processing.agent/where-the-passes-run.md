# Where the passes run

The chain lives here, in `post-processing/chain.js`. It builds one three
`RenderPipeline` over the scene and this plugin registers it as a `post` pass
through `renderer.graph` — the same door every other pass uses.

An effect is `{ name, needsNormals, apply(colour, parts) }` — a function from
the picture so far to a new picture. `parts` carries what an effect cannot make
for itself: the scene pass, the live camera, and a normal and depth pre-pass
when something asked for one.

The renderer owns the context, the scene and the camera. It has to: this engine
draws through an orthographic camera while editing and a perspective one while
playing, and only the renderer knows which, so the chain is rebuilt when that
camera is swapped.

The `post` pass sits between `scene` and whatever draws over the world — First
Person's `viewmodel` pass when that plugin is loaded, the kernel's `ui` pass
otherwise. While it is registered the kernel's `clear` and `scene` passes are
disabled, because the chain renders the scene itself; they are enabled again when
the chain empties. **Nothing closes the chain.** Three's `PostProcessing`
tone-maps and encodes its own output,
which is what the old `OutputPass` was for.

`context.post.hold()` and `context.post.release()` disable and restore the pass
around a borrowed frame, which is how See captures a studio frame with no grade.

## Reading what is actually built

`context.post` carries the state:

| field | is |
|---|---|
| `declared` | the level's `post`, exactly as written |
| `chosen` | what `post.chain` picked this session, or `null` |
| `resolved` | the effects after defaults are filled in |
| `built` | how many effects are in the chain |
| `status` | `off` when nothing is built |

`context.post.set(chain)` is the same call `post.chain` makes, and
`context.post.report()` is what it returns. A problem is reported once per
session; a reload does not repeat it.
