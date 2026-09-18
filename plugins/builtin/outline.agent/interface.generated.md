<!-- Generated from plugins/builtin/outline.js; sha256 a84826c14a0ee2b1040028a50777f7b65ab7566f92a489c6c5d187c85c9ee6de. Do not edit. -->
**Interface, parsed from source** (plugins/builtin/outline.js). Where the prose below it disagrees, this is the code.

```
  plugin     Outline
  category   visuals
  points     1 panel
  commands   outline.show (Outline entities)
             outline.hide (Remove outline)
             outline.toggle (Toggle outline)
             outline.list (Outlined entities)
  arguments  outline.show: what, options
  arguments  outline.hide: what
  arguments  outline.toggle: what, options
  arguments  outline.list: none
  context    context.outline
  listens    entity:removed, selection:changed
  emits      world:changed
  source     221 lines
```
