<!--1ca132e0-->
parsed from source
  plugin Blender Assets
  category editor
  points 1 panel
  commands blender.check (Find the Blender, refuses without a host)
  blender.list
  blender.import (Rebuild changed .blends, refuses without a host)
  blender.inspect (Inspect a .blend, refuses without a host)
  blender.settings
  arguments blender.check:;blender.list:;blender.import: args;blender.inspect: args;blender.settings: args
  systems frame
  listens frame:painted
  source 358 lines
