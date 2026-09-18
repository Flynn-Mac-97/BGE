<!-- Generated from plugins/builtin/rig-animation.js; sha256 75e0af9f43785f6ed421a0e44ec68bb124dbd90d3ce2fd5bc580cdefb8e49e96. Do not edit. -->
**Interface, parsed from source** (plugins/builtin/rig-animation.js). Where the prose below it disagrees, this is the code.

```
  plugin     Rig Animation
  category   visuals
  commands   rig.clips (Rig clips by type)
             rig.load (Load rig clips)
             rig.sources (Stored motion, refuses without a host)
             rig.retarget (Retarget motion, refuses without a host)
             rig.check (Clips against capture, refuses without a host)
             rig.compare (Clip beside capture, refuses without a host)
             rig.play (Play a clip)
  arguments  rig.clips: none
  arguments  rig.load: none
  arguments  rig.sources: none
  arguments  rig.retarget: options = {}
  arguments  rig.check: options = {}
  arguments  rig.compare: options = {}
  arguments  rig.play: { entity, clip }
  context    context.rigAnimation
  systems    fixed
  source     359 lines
```
