<!-- Generated from plugins/builtin/profiler.js; sha256 b6f724f3cef4897592f320a932cf797d3a04426e157cc2fa6b594edbc7e5bd05. Do not edit. -->
**Interface, parsed from source** (plugins/builtin/profiler.js). Where the prose below it disagrees, this is the code.

```
  plugin     Profiler
  category   agents
  lifecycle  scoped
  provides   profiler
  commands   profile.frames (Draw many frames and report what they cost, on the thread and on the card)
             profile.fill (Stack quads that cover the frame on one material, and report what its pixels cost)
             profile.steps (Simulate many fixed steps and report what each system cost)
  arguments  profile.frames: options
  arguments  profile.fill: options
  arguments  profile.steps: options
  context    context.profiler
  source     291 lines
```
