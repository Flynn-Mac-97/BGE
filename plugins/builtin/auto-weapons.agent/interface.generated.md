<!-- Generated from plugins/builtin/auto-weapons.js; sha256 203b745b8e11e28d73714a95460dde6933f0818e5c3644692787c7733d262414. Do not edit. -->
**Interface, parsed from source** (plugins/builtin/auto-weapons.js). Where the prose below it disagrees, this is the code.

```
  plugin     Auto Weapons
  category   game
  needs      Health
  commands   weapons.carried (Who is armed)
             weapons.give (Give a weapon)
             weapons.upgrade (Change weapon numbers)
             weapons.defined (Defined weapons)
  arguments  weapons.carried: none
  arguments  weapons.give: args
  arguments  weapons.upgrade: args
  arguments  weapons.defined: none
  context    context.autoWeapons
  systems    fixed
  listens    entity:removed, level:loaded
  emits      weapon:given {entity, weapon, stats}
             weapon:taken {entity, weapon}
             weapon:upgraded {entity, weapon, stats, changes}
  source     306 lines
```
