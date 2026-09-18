<!-- Generated from plugins/builtin/experience.js; sha256 87ca32de048bfd55e6091fd85076c590abceb3a7e9787d3c8da16685920fbc9f. Do not edit. -->
**Interface, parsed from source** (plugins/builtin/experience.js). Where the prose below it disagrees, this is the code.

```
  plugin     Experience
  category   game
  commands   experience.state (Level and points)
             experience.gain (Award experience)
  arguments  experience.state: none
  arguments  experience.gain: args
  context    context.experience
  listens    level:loaded
  emits      experience:levelled {level, source}
             experience:gained {points, source, level}
  source     162 lines
```
