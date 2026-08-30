---
name: glass-modifiers
description: Modifiers — Stacks named stat changes onto an entity's `properties` and recomputes from the base every time, so any of them can be taken back off. `context.modifiers.add(entity, source, { speed: '+...
---
<!-- generated from plugins/builtin/modifiers.agent.md at server start; edits are lost -->

# Modifiers

- Stacks named stat changes onto an entity's `properties` and recomputes from
  the base every time, so any of them can be taken back off.
- `context.modifiers.add(entity, source, { speed: '+10%', pickupRadius: 0.5 })`.
  A number is an add, a percentage is a scale, `{ add, scale }` says it exactly.
- The rule is `value = (base + every add) * every scale`. Adds before scales, so
  the order picks were taken in never changes the answer.
- The same source name twice **replaces**. An upgrade at rank three is one
  source with bigger numbers, not three sources.
- `remove(entity, source)`, `clear(entity)`, `list(entity)`, `sources(entity)`,
  `base(entity, key)`, `recompute(entity)`.
- Re-applies itself on `type:changed`, so editing a type file mid-run does not
  quietly reset a modified stat.
- Announces `modifiers:changed`. Command: `modifiers.list <entityId>`.
