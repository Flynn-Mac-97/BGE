<!-- Generated from plugins/builtin/render.js; sha256 7d90a84a091a210662297f44198345259ec5f204ba8f555700e0af4afa516436. Do not edit. -->
**Interface, parsed from source** (plugins/builtin/render.js). Where the prose below it disagrees, this is the code.

```
  plugin     Render
  category   visuals
  points     1 panel
  commands   render.look (Render settings)
             render.set (Set render settings)
             render.reset (Drop session settings)
  arguments  render.look: none
  arguments  render.set: args
  arguments  render.reset: none
  systems    frame
  listens    frame:painted, hot:applied, level:loaded, plugins:changed
  source     355 lines
```
