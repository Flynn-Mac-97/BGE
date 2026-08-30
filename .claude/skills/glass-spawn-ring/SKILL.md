---
name: glass-spawn-ring
description: Spawn Ring — Answers "where is just off screen, in metres". `context.spawnRing`. `visibleRadius()` — centre of the screen to a corner, on the ground. Exact for an orthographic view; a flat estimate...
---
<!-- generated from plugins/builtin/spawn-ring.agent.md at server start; edits are lost -->

# Spawn Ring

- Answers "where is just off screen, in metres". `context.spawnRing`.
- `visibleRadius()` — centre of the screen to a corner, on the ground. Exact for an
  orthographic view; a flat estimate times a margin for any other, because a game
  camera that only writes x and y carries no eye height to measure with.
- `point(around, { minimum, maximum, ahead })` — one point on a ring around an
  entity or a point. `ahead` from 0 to 1 pulls the bearing toward the way the
  target is travelling, so a horde cuts the player off instead of trailing.
- `cluster(around, count, { spread, ... })` — several points on one bearing, so a
  flock arrives together and reads as a wave.
- `offScreen(x, z, around, { beyond })` — has something drifted out of sight, so it
  can be taken away and sent back in from the front.
- Distances default off the view; pass `minimum` and `maximum` when you know better.
  This plugin holds no game tuning of its own.
- `run spawnRing.state` says what it measured and whether the answer is exact.
