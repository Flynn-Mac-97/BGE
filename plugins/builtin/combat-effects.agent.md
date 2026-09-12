---
description: Wires combat events to named particle effects and decals: muzzle flash, tracer, blood, dust, bullet holes, explosions. Use when a weapon fires or hits and nothing shows, when restyling what a hit looks like, or when adding an effect to a new combat event.
---

# Combat Effects

- Wires the engine's combat events to named particle effects and decals: `weapon:fired` → muzzle-flash and brass, `weapon:hit` → tracer plus blood or surface dust and a bullet-hole decal, `entity:hurt`/`entity:killed` → blood, `grenade:detonated` → smoke/flash/explosion, `explosion` → fireball and scorch.
- It decides WHEN, never HOW IT LOOKS: effects fire by name, so a game restyles them with `particles.define` (Kitten Survivors turns `blood` into fur dust) and names decal art through `context.particles.art`.
- Surface dust colour comes from the hit entity's `mesh.tint`, else a texture-name table (`concrete`, `metal`, `wood`, ...), else neutral dust. Metal also sparks.
- Every handler reads its event defensively — a missing point or direction means nothing happens, not an error per shot.
- No commands of its own: prove it by emitting an event on `context.bus` and reading `particles.recent`.
- A game wanting a wholly different translation listens to the same events in its own plugin; do not add game rules here.
