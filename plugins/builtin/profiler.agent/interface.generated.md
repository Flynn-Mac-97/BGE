<!-- Generated from plugins/builtin/profiler.js; sha256 59bdcb0d4970387eb4be7af3fca9c4abd0d0ef1e6faf8cf157ba6bf36220c34d. Do not edit. -->
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
  arguments  profile.frames: options
  arguments  profile.fill: options
  arguments  profile.steps: options
  arguments  profile.plan: options
  context    context.profiler
  source     336 lines
```
