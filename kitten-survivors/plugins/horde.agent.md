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
  - `world.state.enemies` and `world.state.kills`, so a HUD needs no wiring
- Per-enemy numbers on `properties`: `health` `maxHealth` `speed` `radius`
  `contactDamage` `bounty` `hover` `wander` `family`.
- Enemies are `body: 'trigger'` — the Horde moves them, not Physics 3D. The
  collider is there so a weapon can raycast one and so touching the kitten
  reports a contact.
- The spawn ring is measured from the camera and then **pulled in to fit the
  meadow**. If the grass is smaller than the ring it says so once, on the console
  and in `horde.stats.arena`, with the width the arena needs. A meadow narrower
  than about three times the visible radius makes enemies appear in view.
- It spawns through `world.spawn`, not `context.spawn`, deliberately: the latter
  announces an editor edit and redraws every dock, twenty times a second.
- `run horde.stats` · `run horde.clear`
