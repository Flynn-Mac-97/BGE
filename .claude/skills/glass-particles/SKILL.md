---
name: glass-particles
description: Particles — Owns `context.particles`: the deterministic particle field — one-shot bursts, trails that follow an entity, and clouds that block sight. Simulation only. **Particle Painter draws it, Co...
---
<!-- generated from plugins/builtin/particles.agent.md at server start; edits are lost -->

# Particles

- Owns `context.particles`: the deterministic particle field — one-shot bursts, trails that follow an entity, and clouds that block sight. Simulation only. **Particle Painter draws it, Combat Effects wires game events onto it.**
- Four verbs:

```js
context.particles.burst({ at: [0, 1, 0], count: 20, speed: [1, 3], life: 0.4, colour: '#ffd07a' })
context.particles.effect('smoke', { at: point })       // a named recipe, anything overridden
const trail = context.particles.trail(entity, { rate: 30, size: 0.05 })
trail.stop()
context.particles.blocked(eye, target)                 // true if smoke is on the line
```

`burst` returns the record it filed, or `null` when it refuses. Every option, with its default:

| key | default | meaning |
|---|---|---|
| `at` | **required** | world metres, `{x,y,z}` or `[x,y,z]`. Missing means nothing is made, reported once |
| `to` | none | spread the count evenly from `at` to here — a tracer is a line, not a ball |
| `count` | `0` | clamped to 0…3000 |
| `direction` | none | normalised here. The direction particles travel |
| `spread` | `0.4` with a direction, `π` without | half-angle in radians. `π` is a sphere |
| `speed` | `0` | metres per second |
| `life` | `1` | seconds. Floored at one fixed step, so `life: 0` flashes once |
| `size` | `0.08` | metres |
| `grow` | `0` | metres per second added to `size` — size over life |
| `gravity` | `0` | metres per second² on Y. **Negative falls** |
| `drag` | `0` | fraction of speed shed per second, never below 0 |
| `fade` | `true` | alpha over life. Read by the painter |
| `colour` | `'#ffffff'` | hex, or a list to pick one from |
| `fadeTo` | none | hex it slides to — colour over life |
| `texture` | `''` | without one the painter draws a soft dot |
| `blend` | `'normal'` | `'add'` or `'normal'`; anything else is normal |
| `blocks` | `0` | metres of radius. Above zero the burst also declares a sight-blocking cloud |
| `blockGrow` | `max(0.5, blocks) / 1.5` | metres per second the cloud opens out to that radius |

`speed` `life` `size` each take a `[least, most]` pair as well as a number. One draw from the random stream either way, so the shape of the option cannot change the sequence.

- `trail(entity, options)` takes every key above plus `rate` (default `20` per second) and returns `{ id, stop() }`. It stops itself when the entity leaves the world, which is what a projectile does on contact.
- `blocked(from, to)` tests the line against the **cloud a burst declared**, not the particles in it, so the smoke you see and the smoke a bot reasons about are one thing. A cloud dies when the longest life in its burst runs out.
- Named effects, all restylable: `muzzle-flash` `tracer` `brass` `wall-hit` `sparks` `blood` `smoke` (declares `blocks: 4`) `flash` `explosion`. `particles.define(name, overrides)` merges over one or adds a new one — that is the game's tuning door, never an edit to the table in the file. `context.particles.art.bulletHole` and `.art.blood` name the decal pictures; the engine ships none.
- Read it back: `.recent(n)` (default 20), `.state` → `{ alive, cap, dropped, clouds, trails, bursts }`, `.count`, `.all`, `.clouds`, `.clear()`.
- Commands: `particles.effect '["smoke", {"at": [0, 1, 0]}]'` · `particles.state` · `particles.recent` · `particles.clear`.
- **Emits no events.** Listens for `level:loaded` and clears — old smoke would be at coordinates that now mean somewhere else, on a clock that went back to zero. **Combat Effects** is what listens to `weapon:fired`, `weapon:hit`, `entity:hurt`, `entity:killed`, `grenade:detonated` and `explosion`, and calls `effect()` for each.
- 3000 particles live at most. Over that the oldest go, counted in `state.dropped`.
- The last 40 bursts are recorded whether or not anything drew them, so a headless test asserts an effect without a browser.
- Deterministic by law: the seeded `context.drawing` stream and `context.time` only — never `Math.random`, `Date.now` or a wall-clock timer. Draws come from the drawing stream, not the simulation's, so adding a visual burst cannot shift what the game rolls next.
