<!-- Generated from plugins/builtin/scatter.js; sha256 c0eed3730fe72fe7958b44383c66c1f80cd6cf6075b10239e194497139e75d86. Do not edit. -->
**Interface, parsed from source** (plugins/builtin/scatter.js). Where the prose below it disagrees, this is the code.

```
  plugin     Scatter
  category   engine
  commands   scatter.list (Scatters and counts)
             scatter.preview (Preview fields)
             scatter.clear (Clear previews)
             scatter.expand (Write placements)
  arguments  scatter.list: none
  arguments  scatter.preview: args
  arguments  scatter.clear: none
  arguments  scatter.expand: args
  context    context.scatter
  listens    level:loaded, world:cleared
  emits      world:changed
  source     534 lines
```
