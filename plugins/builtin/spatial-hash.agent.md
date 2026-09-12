---
description: Who is near whom, over entities that move every step. Use for any near or nearest query at scale: targeting, flocking, pickups, area effects. Crowd moves them; this only finds them.
---

# Spatial Hash

- "Who is near whom", over entities that move every step. `context.spatial`.
  Physics 3D's grid is private and covers only the solids; this covers the movers.
- `context.spatial.group(name, { cellSize, radius })` makes or returns a group.
  Asking twice by the same name gives the same group — that is how two plugins
  share one index instead of building two.
- `group.add(entity)` / `group.remove(entity)`. A destroyed entity leaves on its
  own: the plugin hears `entity:removed` and marks every index stale.
- `group.near(x, z, radius, into)` and `group.nearest(x, z, radius)`. Pass `into`
  to reuse an array — a weapon asks this many times a step.
- The index rebuilds at most once per fixed step, and again the moment membership
  changes. It is never stale, so `near` never hands back something that is gone.
- Membership is explicit, not a filter over the world: a filtered group would walk
  every entity on every query, which is the cost the grid exists to avoid.
- `group.flat` is the index itself — typed arrays and cell offsets — for a caller
  walking neighbours in its own loop. Read it after `index()`, and do not keep it.
- Per-entity `properties.radius` sizes a member; `cellSize` should be about twice
  the widest one. This plugin holds no game tuning.
- `run spatial.stats` reports members, grid size and the widest member.
