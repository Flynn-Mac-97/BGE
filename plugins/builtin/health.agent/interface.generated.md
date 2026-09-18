<!-- Generated from plugins/builtin/health.js; sha256 c871d024cc03bac7631b2e2ea50f07e63afb2d98e22aaea8072c9b54cb1ea834. Do not edit. -->
**Interface, parsed from source** (plugins/builtin/health.js). Where the prose below it disagrees, this is the code.

```
  plugin     Health
  category   game
  commands   health.list (Alive and hurt)
             health.damage (Damage one entity)
             health.give (Give a health pool)
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
