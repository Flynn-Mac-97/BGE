---
description: Sparks, smoke, dust, trails and clouds — the deterministic particle field. Use for anything made of many small moving points. For an effect with a shape rather than a cloud, such as a beam, use VFX; to fire one on a game event, use Combat Effects.
---
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

- `trail(entity, options)` takes every key above plus `rate` (default `20` per second) and returns `{ id, stop() }`. It stops itself when the entity leaves the world, which is what a projectile does on contact.
- `blocked(from, to)` tests the line against the **cloud a burst declared**, not the particles in it, so the smoke you see and the smoke a bot reasons about are one thing. A cloud dies when the longest life in its burst runs out.
- Named effects, all restylable: `muzzle-flash` `tracer` `brass` `wall-hit` `sparks` `blood` `smoke` (declares `blocks: 4`) `flash` `explosion`. `particles.define(name, overrides)` merges over one or adds a new one — that is the game's tuning door, never an edit to the table in the file. `context.particles.art.bulletHole` and `.art.blood` name the decal pictures; the engine ships none.
- Read it back: `.recent(n)` (default 20), `.state` → `{ alive, cap, dropped, clouds, trails, bursts }`, `.count`, `.all`, `.clouds`, `.clear()`.
- Listens for `level:loaded` and clears — old smoke would be at coordinates that now mean somewhere else, on a clock that went back to zero. **Combat Effects** is what listens to `weapon:fired`, `weapon:hit`, `entity:hurt`, `entity:killed`, `grenade:detonated` and `explosion`, and calls `effect()` for each.
- 3000 particles live at most. Over that the oldest go, counted in `state.dropped`.
- The last 40 bursts are recorded whether or not anything drew them, so a headless test asserts an effect without a browser.
- Deterministic by law: the seeded `context.drawing` stream and `context.time` only — never `Math.random`, `Date.now` or a wall-clock timer. Draws come from the drawing stream, not the simulation's, so adding a visual burst cannot shift what the game rolls next.

## Detail

Read only the file your task needs.

- `plugins/builtin/particles.agent/every-key.md` — every option `burst` takes, with its default
