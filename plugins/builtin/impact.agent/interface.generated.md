<!-- Generated from plugins/builtin/impact.js; sha256 38dfc7c6a807d02411c50e635bc56b60aaaf5c78d8eefba23c2bc323d7211576. Do not edit. -->
**Interface, parsed from source** (plugins/builtin/impact.js). Where the prose below it disagrees, this is the code.

```
  plugin     Impact
  category   game
  commands   impact.state (How much the picture has been punched)
             impact.hit (Land one impact by hand)
  arguments  impact.state: none
  arguments  impact.hit: weight
  context    context.impact
  listens    level:loaded
  emits      impact {weight, hold, shake, at}
  source     151 lines
```
