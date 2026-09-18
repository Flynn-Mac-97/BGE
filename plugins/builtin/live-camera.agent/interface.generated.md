<!-- Generated from plugins/builtin/live-camera.js; sha256 9c1326a292549d324d9c05e48c4c71e371bca0d933332ba061f191a87c65cdad. Do not edit. -->
**Interface, parsed from source** (plugins/builtin/live-camera.js). Where the prose below it disagrees, this is the code.

```
  plugin     Live Camera
  category   engine
  points     1 panel
  commands   cameras.state (The live camera, its settings, and where it put the view)
             cameras.activate (Make one camera live regardless of priority; id null returns to priority)
             cameras.kinds (Every camera kind and its settings with defaults)
  arguments  cameras.state: none
  arguments  cameras.activate: options = {}
  arguments  cameras.kinds: none
  context    context.cameras
  systems    frame
  listens    level:loaded, play:started, play:stopped
  source     185 lines
```
