<!-- Generated from plugins/builtin/scatter.js; sha256 b25011559f74bf43443eda08dae81cefb52876391b90c1976a149d4958618276. Do not edit. -->
**Interface, parsed from source** (plugins/builtin/scatter.js). Where the prose below it disagrees, this is the code.

```
  plugin     Scatter
  category   engine
  commands   scatter.list (Every scatter, what it resolves to, and how much of it is standing)
             scatter.preview (Grow the fields in the editor to look at — never saved)
             scatter.clear (Take every previewed field back down)
             scatter.expand (Write the field into the level as real placements, and remove the scatter)
  arguments  scatter.list: none
  arguments  scatter.preview: args
  arguments  scatter.clear: none
  arguments  scatter.expand: args
  context    context.scatter
  listens    level:loaded, world:cleared
  emits      world:changed
  source     537 lines
```
