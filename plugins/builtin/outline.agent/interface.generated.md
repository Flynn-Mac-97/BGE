<!-- Generated from plugins/builtin/outline.js; sha256 26b1a5b362793b7a39d82ed2db4d31acce0c01a2221b037aaa4993b869a25f83. Do not edit. -->
**Interface, parsed from source** (plugins/builtin/outline.js). Where the prose below it disagrees, this is the code.

```
  plugin     Outline
  category   visuals
  points     1 panel
  commands   outline.show (Outline one entity, a list of them, or every one of a type)
             outline.hide (Take the outline off — everything, if nothing is named)
             outline.toggle (Switch the outline on what is named, or on the selection)
             outline.list (What is outlined now, and what an outline looks like)
  arguments  outline.show: what, options
  arguments  outline.hide: what
  arguments  outline.toggle: what, options
  arguments  outline.list: none
  context    context.outline
  listens    entity:removed, selection:changed
  emits      world:changed
  source     221 lines
```
