<!--300e4dba-->
parsed from source
  plugin History
  category editor
  points 1 panel
  commands history.undo (Step back, [ctrl+z])
  history.redo (Step forward, [ctrl+shift+z])
  history.jump
  history.list
  history.clear
  arguments history.undo:;history.redo:;history.jump: index;history.list:;history.clear:
  listens files:written, level:loaded, play:started, play:stopped, selection:changed, world:changed, world:cleared
  emits world:changed
  source 484 lines
