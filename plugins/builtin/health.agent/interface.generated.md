<!-- Generated from plugins/builtin/health.js; sha256 5a22d240bb1277fe501fdee984fb303baea3293f218c8f1c77de32bf389183d5. Do not edit. -->
**Interface, parsed from source** (plugins/builtin/health.js). Where the prose below it disagrees, this is the code.

```
  plugin     Health
  category   game
  commands   health.list (What is alive and how hurt it is)
             health.damage (Damage one entity by id)
             health.give (Give one entity a health pool)
  arguments  health.list: none
  arguments  health.damage: args
  arguments  health.give: args
  context    context.damage, context.heal, context.health
  systems    fixed
  listens    entity:added, entity:removed, level:loaded
  emits      entity:hurt
             entity:killed {victim, remaining}
             entity:healed {entity, amount, remaining}
  source     342 lines
```
