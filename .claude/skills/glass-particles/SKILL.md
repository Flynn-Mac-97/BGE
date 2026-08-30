---
name: glass-particles
description: Particles — Owns the deterministic particle field: one-shot bursts, trails that follow an entity, and clouds that block sight. Simulation only — Particle Painter draws it, Combat Effects wires game...
---
<!-- generated from plugins/builtin/particles.agent.md at server start; edits are lost -->

# Particles

- Owns the deterministic particle field: one-shot bursts, trails that follow an entity, and clouds that block sight. Simulation only — Particle Painter draws it, Combat Effects wires game events onto it.
- An emitter description is data: `count`, `life`, `speed`, `direction`+`spread`, `size`+`grow` (size over life), `colour`+`fadeTo` (colour over life), `gravity`, `drag`, `fade`, `blend`, `texture`, and `blocks` for a sight-blocking cloud. Numbers may be `[least, most]` pairs.
- Drive it: `context.particles.burst({ at, count, ... })`, `.trail(entity, options)`, `.effect(name, overrides)`, `.blocked(from, to)` for line of sight through smoke.
- Tune it from a game: `particles.define(name, overrides)` restyles a named effect; `particles.art.bulletHole` / `.art.blood` name decal art. Game numbers never go in this file.
- Commands: `particles.effect '["smoke", {"at": [0, 1, 0]}]'`, `particles.state`, `particles.recent`, `particles.clear`.
- Deterministic by law: engine `context.random` and `context.time` only — never Math.random, Date.now or a wall-clock timer. Every burst is recorded headless, so a test asserts effects without a browser.
- It refuses a burst with no `at` and reports each mistake once, by name.
- Keep particles out of collision and game truth — the one exception is `blocked`, which answers sight against the cloud a burst declared, so the smoke you see and the smoke a bot reasons about are one thing.
