<!-- Generated from plugins/builtin/lights.js; sha256 68f88370ca0524952bd04cc515e902d525fc768b06c3d392d361f5e415d40f89. Do not edit. -->
**Interface, parsed from source** (plugins/builtin/lights.js). Where the prose below it disagrees, this is the code.

```
  plugin     Lights
  category   visuals
  points     1 panel
  commands   lights.list (Every light in the level, and whether it is lighting anything)
             lights.bake (What an offline baker would bake — every static surface and light)
             lights.flash (Fire a one-shot light, to find a colour and a duration by eye)
  arguments  lights.list: none
  arguments  lights.bake: options
  arguments  lights.flash: options
  context    context.lights
  systems    fixed, frame
  listens    entity:added, entity:removed, frame:painted, level:loaded, world:changed, world:cleared
  emits      world:changed
  source     1002 lines
```
