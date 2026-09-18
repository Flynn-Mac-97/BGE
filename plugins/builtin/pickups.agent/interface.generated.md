<!-- Generated from plugins/builtin/pickups.js; sha256 ad16ef7adbde5b11744a7afab5d02fef0e592f2f0a2544901e534bb91fb53e35. Do not edit. -->
**Interface, parsed from source** (plugins/builtin/pickups.js). Where the prose below it disagrees, this is the code.

```
  plugin     Pickups
  category   game
  commands   pickups.list (Waiting pickups)
             pickups.attract (Pull pickups in)
  arguments  pickups.list: none
  arguments  pickups.attract: none
  context    context.pickups
  systems    fixed
  listens    level:loaded
  emits      pickup:collected {entity, collector, kind, value}
             pickup:latched {entity, collector}
  source     209 lines
```
