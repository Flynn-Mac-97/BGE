<!-- Generated from plugins/builtin/history.js; sha256 ed4a154a47b316e6d52da7d8c1900307536a36a65cdbb1d8acfecbef828b5e53. Do not edit. -->
**Interface, parsed from source** (plugins/builtin/history.js). Where the prose below it disagrees, this is the code.

```
  plugin     History
  category   editor
  points     1 panel
  commands   history.undo (Step back, [ctrl+z])
             history.redo (Step forward, [ctrl+shift+z])
             history.jump (Jump to a step)
             history.list (List the recorded steps)
             history.clear (Forget the recorded steps)
  arguments  history.undo: none
  arguments  history.redo: none
  arguments  history.jump: index
  arguments  history.list: none
  arguments  history.clear: none
  listens    files:written, level:loaded, play:started, play:stopped, selection:changed, world:changed, world:cleared
  emits      world:changed
  source     484 lines
```
