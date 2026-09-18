<!-- Generated from plugins/builtin/auto-weapons.js; sha256 f0b7076e59bc1b8bab3d8b3da81811d029c61e04bf1622d881aea0e4e88ee761. Do not edit. -->
**Interface, parsed from source** (plugins/builtin/auto-weapons.js). Where the prose below it disagrees, this is the code.

```
  plugin     Auto Weapons
  category   game
  needs      Health
  commands   weapons.carried (Who is armed with what)
             weapons.give (Give an entity a weapon)
             weapons.upgrade (Change the numbers on a carried weapon)
             weapons.defined (Every weapon the game has described)
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
