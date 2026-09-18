<!-- Generated from plugins/builtin/rapier-3d.js; sha256 4ba78788a6ab554f7c39cb4d62c6674365829850d016131e7e0c075def9f32b5. Do not edit. -->
**Interface, parsed from source** (plugins/builtin/rapier-3d.js). Where the prose below it disagrees, this is the code.

```
  plugin     Rapier 3D
  category   engine
  points     1 panel
  commands   rapier3d.use (Switch 3D physics between Rapier and the built-in solver)
             rapier3d.bodies (What Rapier 3D is simulating)
             rapier3d.snapshot (Hash the simulated world, to prove two runs match)
             rapier3d.raycast (Cast a ray and say what it hit)
  arguments  rapier3d.use: options
  arguments  rapier3d.bodies: none
  arguments  rapier3d.snapshot: none
  arguments  rapier3d.raycast: argument
  context    context.canStand, context.raycast
  systems    fixed
  source     313 lines
```
