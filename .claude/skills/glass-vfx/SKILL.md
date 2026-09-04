---
name: glass-vfx
description: VFX — Owns `context.vfx`: effect kinds that have a **shape** rather than a cloud of points. Particles owns anything that is a cloud; this owns everything a particle cannot say.
---
<!-- generated from plugins/builtin/vfx.agent.md at server start; edits are lost -->

# VFX

- Owns `context.vfx`: effect kinds that have a **shape** rather than a cloud of points. Particles owns anything that is a cloud; this owns everything a particle cannot say. A beam has a direction and a ribbon has a width across it, so both break into dots when built from particles and fall apart as the camera turns.
- One kind today: `context.vfx.beams`. Each kind is a deterministic field, simulated on the fixed clock, recorded headless, drawn only in a browser.

```js
context.vfx.beams.beam({ from: [0, 8, 0], to: [0, 0, 0], jitter: 0.3, flicker: 18 })
context.vfx.beams.strike({ at: point, height: 8 })            // a bolt down onto a point
context.vfx.beams.effect('laser', { from: muzzle, to: hit })  // a named recipe, anything overridden
const tether = context.vfx.beams.link(entityA, entityB)
tether.stop()
```

`beam` returns the record it filed, or `null` when it refuses. Every option, with its default:

| key | default | meaning |
|---|---|---|
| `from` `to` | **required** | world metres, `{x,y,z}` or `[x,y,z]`. Missing means nothing is made, reported once |
| `life` | `0.35` | seconds. Floored at one fixed step |
| `width` | `0.08` | metres across the ribbon |
| `jitter` | `0` | sideways displacement as a fraction of length. Above zero it is a bolt, not a beam |
| `segments` | `12` | clamped 2…48 |
| `flicker` | `0` | times per second the displacement is re-rolled |
| `taper` | `'both'` | `'both'` `'from'` `'to'` `'none'` |
| `colour` | `'#ffffff'` | hex, the halo |
| `core` | `'#ffffff'` | hex, the hot centre |
| `fadeTo` | none | hex the halo slides to over the beam's life |
| `blend` | `'add'` | `'add'` or `'normal'` |

- `link(a, b, options)` returns `{ id, stop() }` and stops itself when either entity leaves the world.
- Named beams: `bolt` `laser` `arc`. `vfx.beams.define(name, overrides)` merges over one or adds a new one — that is the game's tuning door, never an edit to the table in the file.
- `points(record, time)` is a beam's spine as flat world metres and `shapeAt(record, along, time)` its width and alpha. Both are pure functions of the record and the clock, so the picture and a test read one implementation.
- Read it back: `vfx.state` → every kind's counts, `vfx.recent(n)`, `vfx.kinds`, `vfx.clear()`. Per kind: `.recent(n)`, `.state`, `.count`, `.all`, `.names`.
- Commands: `vfx.beam '["laser", {"from": [0,1,0], "to": [4,1,0]}]'` · `vfx.state` · `vfx.recent` · `vfx.clear`.
- 64 beams live at most. Over that the oldest go, counted in `state.dropped`.
- **Adding a kind** is one module in `plugins/builtin/vfx/` exporting `{ kind, title, about, make, painter }` and one entry in `KINDS`. `make` builds the field — it must answer `bind` `step` `clear` `recent` `state`. `painter` is imported only after `shell:ready`, so headless never parses drawing code. Nothing in `vfx.js` knows what a beam is.
- **Emits no events.** Listens for `level:loaded` and clears. Deterministic by law: the seeded `context.drawing` stream and `context.time` only — one draw per effect whatever its options say, so adding a visual cannot shift what the game rolls next.
