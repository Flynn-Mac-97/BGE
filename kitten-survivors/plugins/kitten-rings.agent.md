# Kitten Rings

- The two weapons that are a shape around you rather than a shot: the yarn that turns, and the purr that sweeps out.
- `context.kittenRings.orbit({ owner, count, radius, turn, seconds, damage, every, knockback, size, tint, hits, source })` — balls spaced evenly round a ring, hurting what they touch.
- `context.kittenRings.sweep({ owner, at, from, reach, grow, damage, knockback, hits, source })` — a ring that opens out and hits each thing once as the edge reaches it. Once, not continuously, so standing inside one is not a grinder.
- Both take a `hits(entity)` test, the same way `context.projectiles.fire` does. Neither knows what an enemy is.
- Both announce `weapon:hit`, so the particles and Kitten Hit Feel react to them exactly as they do to a bullet.
- Separate from Kitten Weapons because it is a different job: that file says what a weapon costs and how often, this one owns the shapes that hang about afterwards.
- Check with `kitten.rings`; unravel everything with `kitten.rings.clear`.
