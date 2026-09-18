---
name: glass-crowd
description: Moves many entities as one mass and stops them stacking. Use for hordes, swarms, flocks and any group that must seek a target without piling up. The near-query half is Spatial Hash.
---
<!-- generated from plugins/builtin/crowd.agent.md at server start; edits are lost -->

Read the generated interface in `plugins/builtin/crowd.agent/interface.generated.md`. Plugin edits refresh it while the server runs. This packet command also checks freshness:

```sh
node bin/engine.mjs agent.context '{"task":"…","files":["plugins/builtin/crowd.js"]}'
```

# Crowd

- Moves many entities as one mass and stops them stacking.
  The "who is near whom" half is Spatial Hash; this is the pass that moves them.
- `context.crowd.group(name, { cellSize, radius, speed })` wraps the Spatial Hash
  group of the same name, so `context.spatial.group('horde')` is the same index.
- `group.add(entity)` / `group.remove(entity)`, and `near` / `nearest` pass straight
  through to Spatial Hash.
- `group.drive(seconds, { towards, separation, relax, face })` is one step: seek the
  target, blend in separation, renormalise, then shove overlaps apart. Call it from
  your own fixed system, so "decide then move" stays visible in one file.
- `separation` is the number the look of a crowd hangs on. Too high and it orbits
  instead of closing; too low and it stacks into a column and reads as one body.
- Per-entity numbers come off `entity.properties`: `speed`, `radius`, `wander`
  (radians of heading wobble). This plugin holds no game tuning.
- Set `entity.headingX` and `entity.headingZ` to commit one member to a direction:
  it stops seeking and stops wandering until they are cleared to zero, but is still
  shoved out of bodies. That is how a charge stays a straight line without taking
  the member out of the group.
- Writes `x`, `z`, `velocityX`, `velocityZ` and `rotation`. It never touches `y` —
  hover height belongs to whoever owns the entity.
- It is not physics: members do not collide with solids and gravity does not apply.
  Give them a collider only if something else needs to raycast them.
- `run crowd.stats` reports the neighbour tests the last step cost. The cost is work
  done, not wall time, so a replay reports the same number.
