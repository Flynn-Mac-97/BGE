<!-- Generated from plugins/builtin/vfx.js; sha256 ffe29da485b20863770cb5140e776a5e34733f0640231e90a573a0770fc5e48b. Do not edit. -->
**Interface, parsed from source** (plugins/builtin/vfx.js). Where the prose below it disagrees, this is the code.

```
  plugin     VFX
  category   visuals
  commands   vfx.state (How much of each effect kind is alive)
             vfx.recent (Effects recently made)
             vfx.clear (Remove every effect)
             vfx.beam (Make a named beam)
  arguments  vfx.state: none
  arguments  vfx.recent: n
  arguments  vfx.clear: none
  arguments  vfx.beam: argument
  context    context.vfx
  systems    fixed, frame
  listens    level:loaded, shell:ready
  source     126 lines
```
