<!-- Generated from plugins/builtin/experience.js; sha256 c31e080a694e33c9df910ce73676170c94f5ec6788e4a9a2da1b677183543a6a. Do not edit. -->
**Interface, parsed from source** (plugins/builtin/experience.js). Where the prose below it disagrees, this is the code.

```
  plugin     Experience
  category   game
  commands   experience.state (Level and points)
             experience.gain (Award experience points)
  arguments  experience.state: none
  arguments  experience.gain: args
  context    context.experience
  listens    level:loaded
  emits      experience:levelled {level, source}
             experience:gained {points, source, level}
  source     162 lines
```
