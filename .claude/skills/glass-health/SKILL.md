---
name: glass-health
description: Hurt, kill or heal something, and decide how much damage it takes. Use when adding damage, hit points, armour, resistances, invulnerability windows, damage-over-time, or anything that reduces or restores health. `context.damage()` is the one verb every source of harm goes through.
---
<!-- generated from plugins/builtin/health.agent.md at server start; edits are lost -->

Read the generated interface in `plugins/builtin/health.agent/interface.generated.md`. Plugin edits refresh it while the server runs. This packet command also checks freshness:

```sh
node bin/engine.mjs agent.context '{"task":"…","files":["plugins/builtin/health.js"]}'
```

# Health

- Owns the one damage verb: `context.damage(target, amount, how)` â†’ `{ dealt, remaining, killed, blocked }`.
- State is `entity.damageable`: `health`, `maxHealth`, `alive`, `lastHurtBy`, `linger`, `removeOnDeath`.
- A type declaring `health` gets a pool on first hit; otherwise `context.health.give(entity, { health, maxHealth, removeOnDeath, linger })`.
- Hit flash, knockback, numbers and shake are other plugins.
- Removes a body `linger` seconds after death, default 0.35; a player sets `removeOnDeath: false`.
- Owns only entities it set up; a game publishing `context.damage` shadows it.
- Check with `health.list`; drive with `health.damage '["id", 25]'`.

## Detail

- `plugins/builtin/health.agent/damage.md` â€” `how` fields, `context.health` verbs
