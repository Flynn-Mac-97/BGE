---
name: glass-projectiles
description: Projectiles — Fires shots that fly, pierce, home and expire: `context.projectiles.fire(shot)` returns the entity. `shot`: `from` (entity or point), `direction`, `speed`, `damage`, `life`, `radius`,...
---
<!-- generated from plugins/builtin/projectiles.agent.md at server start; edits are lost -->

# Projectiles

- Fires shots that fly, pierce, home and expire: `context.projectiles.fire(shot)` returns the entity.
- `shot`: `from` (entity or point), `direction`, `speed`, `damage`, `life`, `radius`, `pierce`, `knockback`, `homing`, `gravity`, `spin`, `hits(entity)`, `owner`, `source`, `every`, `mesh`, `onHit(target, result, shot)`, `onEnd(shot, why)`.
- A shot is a real entity spawned under the type name `projectile`, so the renderer, the Scene tree and `world.all('projectile')` all see it. No type file is required — the mesh comes from the shot.
- Hits are swept over the step and measured between footprints, so raising `speed` never starts passing through people. A shot never hits its `owner`, never hits the same target twice, and only hits things with `entity.damageable`.
- `pierce` is how many EXTRA bodies it passes through. `pierce: 0` stops on the first.
- Announces `weapon:fired`, `weapon:hit` and `projectile:ended` — Particles already draws muzzle flash, tracer and impact off the first two.
- Damage goes through `context.damage`, so Health decides the kill. With no damage verb loaded a shot flies and hits nothing.
- Check with `projectiles.list`; empty the air with `projectiles.clear`.
