---
description: Pickups any entity can drop and a collector magnets in. Use for coins, gems, XP orbs, health drops and anything the player collects by touch or by magnet.
category: gameplay
---

# Pickups

- A pickup is any entity with `properties.pickup` set. The value is the kind —
  a plain word this plugin never interprets — and `properties.value` is the amount.
- `context.pickups.drop(type, at, { pickup, value })` puts one in the world.
- `context.pickups.collector = entity | id | () => entity` says who they come to.
  With nothing set it falls back to whoever the camera follows.
- The magnet: a pickup **latches** inside the collector's radius and keeps
  following after you leave it, **accelerates** from a walking pace to far faster
  than you can run, and **never misses**. Tune with
  `configure({ radius, grab, startSpeed, acceleration, maximumSpeed })`;
  a collector's own `properties.pickupRadius` beats the setting.
- `properties.bobHeight` / `bobSpeed` make an untouched pickup bob so a field of
  them reads as loot. Silent when unset.
- What a kind *means* is the game's business — wire it in one line.
- `attractAll()` latches everything now. Pickups are cleared on `level:loaded`.
