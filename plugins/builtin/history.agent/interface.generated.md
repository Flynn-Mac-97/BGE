<!-- Generated from plugins/builtin/history.js; sha256 f6da9dc787bde2a429b834aee04208950f8105d6096f737a50fd37a1dcc6d109. Do not edit. -->
**Interface, parsed from source** (plugins/builtin/history.js). Where the prose below it disagrees, this is the code.

```
  plugin     History
  category   editor
  points     1 panel
  commands   history.undo (Step back, [ctrl+z])
             history.redo (Step forward, [ctrl+shift+z])
             history.jump (Jump to a step)
             history.list (Recorded steps)
             history.clear (Forget history)
  arguments  history.undo: none
  arguments  history.redo: none
  arguments  history.jump: index
  arguments  history.list: none
  arguments  history.clear: none
  listens    files:written, level:loaded, play:started, play:stopped, selection:changed, world:changed, world:cleared
  emits      world:changed
  source     484 lines
```
