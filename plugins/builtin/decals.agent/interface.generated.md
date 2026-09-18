<!-- Generated from plugins/builtin/decals.js; sha256 c0c2e3c39ed3b80a3c97cf880aa7e99ff68600f39533207dfe127e0c7a90470a. Do not edit. -->
**Interface, parsed from source** (plugins/builtin/decals.js). Where the prose below it disagrees, this is the code.

```
  plugin     Decals
  category   visuals
  commands   decals.recent (Marks left on the world)
             decals.state (How full the decal budget is)
             decals.clear (Wipe every decal)
  arguments  decals.recent: n
  arguments  decals.state: none
  arguments  decals.clear: none
  context    context.decals
  systems    fixed, frame
  listens    level:loaded, shell:ready
  source     490 lines
```
