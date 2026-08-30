# Horde

- The live crowd on the meadow, and the one place other lanes reach it.
  What arrives and when is Horde Waves; how it moves is Horde Drive; what a
  minute is worth is Horde Schedule.
- Five families, each a type file: `rat` `crow` `hound` `wasp` `boar`. Silhouette,
  colour and hover height belong to the type; health and speed are scaled here on
  the way in.
- What other lanes read, with nothing agreed in advance:
  - `context.horde.near(x, z, radius, into)` and `.nearest(x, z, radius)`
  - `context.horde.touching(entity, extra)` — everything overlapping a body, which
    is all the kitten lane needs to take contact damage
  - `context.horde.hurt(entity, amount, by)` → `{ killed, health }`
  - an enemy whose `properties.health` hits zero by any means dies on the next
    step: the sweep trusts the number, not the caller
  - bus `enemy:died` → `{ entity, family, at, bounty, by }`, fired before it goes
  - **a death leaves the roster at once and the body a moment later.** The enemy
    is taken out of the crowd on the step it dies, so a corpse neither steers
    nor holds a place under the population cap, and the body stands for
    `BODY_LINGER` so Hit Reaction has frames to collapse it in. Health removes a
    body it declared dead; this file removes one that only had its
    `properties.health` set to zero.
  - `world.state.enemies` and `world.state.kills`, so a HUD needs no wiring
- Per-enemy numbers on `properties`: `health` `maxHealth` `speed` `radius`
  `contactDamage` `bounty` `hover` `wander` `family`.
- Enemies are `body: 'trigger'` — the Horde moves them, not Physics 3D. The
  collider is there so a weapon can raycast one and so touching the kitten
  reports a contact.
- The spawn ring is measured from the LEVEL's camera rule — the camera the
  player plays behind — never from the editor viewport, whose size is whatever
  panel arrangement the author left. Only the screen's shape is read.
- **The ring is not a circle.** The frame is a trapezoid on the ground, and
  `horde.stats.frame` gives its three numbers: about 8m ahead of the kitten, 4m
  behind it, 11m to the side. `context.horde.ringToward(bearing)` answers the
  band for one bearing — the frame's own edge there, times `RING_NEAR` to
  `RING_FAR`, held out to `LEAST_WARNING` metres so nothing arrives as a hit
  with no warning. `ringNear`/`ringFar` are the widest bearing, which is what
  "definitely out of sight" means.
- `context.horde.sendBackIn(entity, x, z)` moves a live enemy to a new place.
  Horde Waves uses it on anything that has fallen out of the picture, so the
  population cap and the spawn rate stay exactly where the schedule set them.
- The ring is **scaled to fit the meadow**: if the grass is smaller than the ring
  it says so once, on the console and in `horde.stats.arena`, with the width the
  arena needs. A meadow narrower than about `horde.stats.arena.wantsAcross`
  makes enemies appear well inside the frame.
- It spawns through `world.spawn`, not `context.spawn`, deliberately: the latter
  announces an editor edit and redraws every dock, twenty times a second.
- `run horde.stats` · `run horde.clear`
