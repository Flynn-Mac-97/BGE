<!-- Generated from plugins/builtin/profiler.js; sha256 8eed2f5635c8a605d51c56b03b9086d68225e8e9f3fd8682737e3c3dde1efcf5. Do not edit. -->
**Interface, parsed from source** (plugins/builtin/profiler.js). Where the prose below it disagrees, this is the code.

```
  plugin     Profiler
  category   agents
  lifecycle  scoped
  provides   profiler
  commands   profile.frames (Cost frames)
             profile.fill (Cost quad pixels)
             profile.steps (Cost per system)
             profile.plan (Cost per-entity description)
             profile.sync (Cost per-entity sync)
  arguments  profile.frames: options
  arguments  profile.fill: options
  arguments  profile.steps: options
  arguments  profile.plan: options
  arguments  profile.sync: options
  context    context.profiler
  source     388 lines
```
