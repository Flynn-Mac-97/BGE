<!-- Generated from plugins/builtin/blender-assets.js; sha256 ebebbc5155c4b0449e3cb47e9c6ed4f1a44fd97ad0b2d91ff741c17e17f84a42. Do not edit. -->
**Interface, parsed from source** (plugins/builtin/blender-assets.js). Where the prose below it disagrees, this is the code.

```
  plugin     Blender Assets
  category   editor
  points     1 panel
  commands   blender.check (Find the Blender this machine will use, refuses without a host)
             blender.list (Every .blend in the project, and whether its model is current)
             blender.import (Build the .glb for a .blend that changed, refuses without a host)
             blender.inspect (What a .blend holds: each character's armature, meshes, height and the collection setting that exports it, refuses without a host)
             blender.settings (Write the import settings for a .blend)
  arguments  blender.check: none
  arguments  blender.list: none
  arguments  blender.import: args
  arguments  blender.inspect: args
  arguments  blender.settings: args
  systems    frame
  listens    frame:painted
  source     360 lines
```
