<!-- Generated from plugins/builtin/blender-assets.js; sha256 7269536fb1a555e539f947e241b5b41283bbc7188d388a97de9f67b573de5aa7. Do not edit. -->
**Interface, parsed from source** (plugins/builtin/blender-assets.js). Where the prose below it disagrees, this is the code.

```
  plugin     Blender Assets
  category   editor
  points     1 panel
  commands   blender.check (Find the Blender, refuses without a host)
             blender.list (Blends and freshness)
             blender.import (Rebuild changed .blends, refuses without a host)
             blender.inspect (Inspect a .blend, refuses without a host)
             blender.settings (Import settings)
  arguments  blender.check: none
  arguments  blender.list: none
  arguments  blender.import: args
  arguments  blender.inspect: args
  arguments  blender.settings: args
  systems    frame
  listens    frame:painted
  source     357 lines
```
