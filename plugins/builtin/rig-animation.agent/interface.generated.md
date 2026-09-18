<!-- Generated from plugins/builtin/rig-animation.js; sha256 71b94ff64e10371f41c669bdc3111da7647c4f7cc68cf6e8e97f122573375449. Do not edit. -->
**Interface, parsed from source** (plugins/builtin/rig-animation.js). Where the prose below it disagrees, this is the code.

```
  plugin     Rig Animation
  category   visuals
  commands   rig.clips (Rig clips by type)
             rig.load (Load every declared rig clip)
             rig.sources (Stored motion in assets/motion/source, ready to retarget, refuses without a host)
             rig.retarget (Put stored motion onto a model: {"model":"models/hero.glb","clips":["idle","walk"],"once":["death"]}, refuses without a host)
             rig.check (Measure a model's clips against their capture — height, floor, limbs, still bones, loop seam: {"model":"models/hero.glb"}, refuses without a host)
             rig.compare (Render a clip in Blender beside its capture, front and side: {"model":"models/hero.glb","clip":"run","frames":[0,6,12]}, refuses without a host)
             rig.play (Play a clip on one entity)
  arguments  rig.clips: none
  arguments  rig.load: none
  arguments  rig.sources: none
  arguments  rig.retarget: options = {}
  arguments  rig.check: options = {}
  arguments  rig.compare: options = {}
  arguments  rig.play: { entity, clip }
  context    context.rigAnimation
  systems    fixed
  source     360 lines
```
