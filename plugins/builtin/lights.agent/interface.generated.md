<!-- Generated from plugins/builtin/lights.js; sha256 ff4355173e88ffce0ec4da5b99a7fc5b0bee10bf7761118ebb8baf1faa22a330. Do not edit. -->
**Interface, parsed from source** (plugins/builtin/lights.js). Where the prose below it disagrees, this is the code.

```
  plugin     Lights
  category   visuals
  points     1 panel
  commands   lights.list (Level lights)
             lights.bake (Offline bake result)
             lights.flash (Flash a light)
  arguments  lights.list: none
  arguments  lights.bake: options
  arguments  lights.flash: options
  context    context.lights
  systems    fixed, frame
  listens    entity:added, entity:removed, frame:painted, level:loaded, world:changed, world:cleared
  emits      world:changed
  source     1002 lines
```
