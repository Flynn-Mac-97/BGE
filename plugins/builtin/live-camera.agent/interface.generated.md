<!-- Generated from plugins/builtin/live-camera.js; sha256 ed0448ccf2805d212509235d59d39ac5a7606d6c59d9a42e92637b75f5319e83. Do not edit. -->
**Interface, parsed from source** (plugins/builtin/live-camera.js). Where the prose below it disagrees, this is the code.

```
  plugin     Live Camera
  category   engine
  points     1 panel
  commands   cameras.state (Live camera state)
             cameras.activate (Activate a camera)
             cameras.kinds (Camera kinds)
  arguments  cameras.state: none
  arguments  cameras.activate: options = {}
  arguments  cameras.kinds: none
  context    context.cameras
  systems    frame
  listens    level:loaded, play:started, play:stopped
  source     185 lines
```
