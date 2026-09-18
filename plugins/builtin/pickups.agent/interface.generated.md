<!-- Generated from plugins/builtin/pickups.js; sha256 29a32cff8b3f22e36ebec0acb5f91d9cc5163a027f414172aed13b29d8462d1e. Do not edit. -->
**Interface, parsed from source** (plugins/builtin/pickups.js). Where the prose below it disagrees, this is the code.

```
  plugin     Pickups
  category   game
  commands   pickups.list (What is waiting to be picked up)
             pickups.attract (Pull every pickup in now)
  arguments  pickups.list: none
  arguments  pickups.attract: none
  context    context.pickups
  systems    fixed
  listens    level:loaded
  emits      pickup:collected {entity, collector, kind, value}
             pickup:latched {entity, collector}
  source     209 lines
```
