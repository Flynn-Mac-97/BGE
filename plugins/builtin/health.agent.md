---
description: Hurt, kill or heal something, and decide how much damage it takes. Use when adding damage, hit points, armour, resistances, invulnerability windows, damage-over-time, or anything that reduces or restores health. `context.damage()` is the one verb every source of harm goes through.
---
# Health

- Owns the one damage verb: `context.damage(target, amount, how)` → `{ dealt, remaining, killed, blocked }`.
- `how` carries `from`, `source`, `every` (seconds this source must wait before hitting the same target again), `direction`, `point`, `critical`, `hitbox`, `invulnerableFor`.
- State is `entity.damageable` — `health`, `maxHealth`, `alive`, `lastHurtBy`, `linger`, `removeOnDeath`. Read the bag; never ask this plugin.
- A type that declares `health` in `properties` gets a pool on its first hit. Otherwise call `context.health.give(entity, { health, maxHealth, removeOnDeath, linger })`.
- Also on `context.health`: `nearest(point, { within, hits })`, `living(test)`, `damageInRadius({ at, radius, damage, hits, from })`, `radiusOf(entity)`, `of(entity)`, `alive(entity)`.
- Hit flash, knockback, floating numbers and screen shake are other plugins listening on the same bus — this file has no theatre in it.
- Removes a body `linger` seconds after death, default 0.35. A player sets `removeOnDeath: false`; nothing else has to.
- Only manages entities it set up. A game that publishes its own `context.damage` shadows this one, and this one then touches nothing.
- Check with `health.list`; drive with `health.damage '["id", 25]'` and `health.give '["id", {"health": 40}]'`.
