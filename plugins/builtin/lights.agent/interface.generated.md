<!--3a47feda-->
parsed from source
  plugin Lights
  category visuals
  points 1 panel
  commands lights.list
  lights.bake
  lights.flash
  arguments lights.list:;lights.bake: options;lights.flash: options
  context lights
  systems fixed, frame
  listens entity:added, entity:removed, frame:painted, level:loaded, world:changed, world:cleared
  emits world:changed
  source 1002 lines
