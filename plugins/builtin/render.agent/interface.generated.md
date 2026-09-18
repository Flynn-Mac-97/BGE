<!-- Generated from plugins/builtin/render.js; sha256 8f81d04fb6384b0b0702405bd1b3c9ab741f579c4409746efd7e059b6588932c. Do not edit. -->
**Interface, parsed from source** (plugins/builtin/render.js). Where the prose below it disagrees, this is the code.

```
  plugin     Render
  category   visuals
  points     1 panel
  commands   render.look (Every render setting, its value, where it came from, and its options)
             render.set (Change render settings, written to game.json unless told otherwise)
             render.reset (Drop the session-only settings and use the files again)
  arguments  render.look: none
  arguments  render.set: args
  arguments  render.reset: none
  systems    frame
  listens    frame:painted, hot:applied, level:loaded, plugins:changed
  source     357 lines
```
