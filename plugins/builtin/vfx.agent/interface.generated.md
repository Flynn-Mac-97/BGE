<!-- Generated from plugins/builtin/vfx.js; sha256 2e5b6db234d4e758d9ae5313d09535277e7b8ab437dcf783d27227695eb78530. Do not edit. -->
**Interface, parsed from source** (plugins/builtin/vfx.js). Where the prose below it disagrees, this is the code.

```
  plugin     VFX
  category   visuals
  commands   vfx.state (Live effects by kind)
             vfx.recent (Recent effects)
             vfx.clear (Clear effects)
             vfx.beam (Make a beam)
  arguments  vfx.state: none
  arguments  vfx.recent: n
  arguments  vfx.clear: none
  arguments  vfx.beam: argument
  context    context.vfx
  systems    fixed, frame
  listens    level:loaded, shell:ready
  source     126 lines
```
