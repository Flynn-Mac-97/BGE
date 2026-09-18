<!-- Generated from plugins/builtin/shader-languages.js; sha256 d236095b8c9bb5099f15fb86966df8a6002dc232d86413b6739ce52cd988071d. Do not edit. -->
**Interface, parsed from source** (plugins/builtin/shader-languages.js). Where the prose below it disagrees, this is the code.

```
  plugin     Shader Languages
  category   visuals
  needs      Materials
  points     1 panel
  commands   shader.languages (Every shader language, and whether the live backend can build it)
             shader.list (Every shader, the languages it is written in, and the one it is built from)
             shader.prefer (Prefer a shader language, and rebuild every shader that moved)
  arguments  shader.languages: none
  arguments  shader.list: none
  arguments  shader.prefer: language
  context    context.shaderLanguages
  listens    shell:ready
  emits      shader:swapped {moved}
  source     186 lines
```
