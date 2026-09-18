---
name: glass-auto-weapons
description: Weapons that fire themselves on a cooldown, with stats, upgrades and levels. Use for any auto-attacking weapon, survivor-style builds, orbiting or periodic attacks, and when tuning or upgrading weapon numbers at runtime.
---
<!-- generated from plugins/builtin/auto-weapons.agent.md at server start; edits are lost -->

Read the generated interface in `plugins/builtin/auto-weapons.agent/interface.generated.md`. Plugin edits refresh it while the server runs. This packet command also checks freshness:

```sh
node bin/engine.mjs agent.context '{"task":"…","files":["plugins/builtin/auto-weapons.js"]}'
```

# Auto Weapons

- Weapons that fire themselves on a cooldown. Nothing here reads input.
- `context.autoWeapons.define(name, { stats, fire(context, owner, weapon), ready, start, stop, upgraded, warmUp })`.
- `give(owner, name, overrides)` arms someone; `take(owner, name)` disarms; `fireNow(owner, name)` skips the cooldown.
- Every number is in `weapon.stats`: `level damage cooldown count area speed duration pierce knockback`. A weapon may add its own; nothing here is a fixed list.
- **Upgrades are the point.** `upgrade(owner, name, { damage: '+4', cooldown: '*0.9', count: 2 })` — a plain number sets, `+`/`-`/`*` adjust. `levelUp(owner, name, changes)` adds one level too.
- `weapon.state` is the weapon's own scratch bag between shots (an orbit angle, the last target). Stats are public; state is not.
- Cooldown never goes below 1/30s however far it is upgraded.
- A weapon that throws is reported by name and skipped; the rest of the build keeps firing.
- Named `Auto Weapons` and published as `context.autoWeapons` so it cannot collide with a project plugin called `Weapons`.
- Check with `weapons.carried` and `weapons.defined`; drive with `weapons.give '["you","claw dart"]'` and `weapons.upgrade '["you","claw dart",{"damage":"+5"}]'`.
