# Where the passes run

The chain is not in this plugin. `renderer.passes.set(list)` takes an ordered
list of effects and has no opinion whatever about what they do.

An effect is `{ name, needsNormals, apply(colour, parts) }` — a function from
the picture so far to a new picture. `parts` carries what an effect cannot make
for itself: the scene pass, the live camera, and a normal and depth pre-pass
when something asked for one.

The renderer owns the context, the render targets, the resize and the scene pass
at the front. It has to: this engine draws through an orthographic camera while
editing and a perspective one while playing, and only the renderer knows which,
so it rebuilds the chain when that camera is swapped.

Everything after the scene pass is this plugin's: the effects the level asked
for, in the order it wrote them. **Nothing closes the chain.** Three's
`PostProcessing` tone-maps and encodes its own output, which is what the old
`OutputPass` was for.

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
