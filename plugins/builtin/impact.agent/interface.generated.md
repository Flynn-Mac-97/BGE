<!-- Generated from plugins/builtin/impact.js; sha256 f7ed355a68efb164eb9552cb7fe5c6da4fbc9c70d0319ddfce62359745439e3b. Do not edit. -->
**Interface, parsed from source** (plugins/builtin/impact.js). Where the prose below it disagrees, this is the code.

```
  plugin     Impact
  category   game
  commands   impact.state (Screen punch state)
             impact.hit (Land one impact)
  arguments  impact.state: none
  arguments  impact.hit: weight
  context    context.impact
  listens    level:loaded
  emits      impact {weight, hold, shake, at}
  source     151 lines
```
