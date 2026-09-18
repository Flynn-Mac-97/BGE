<!-- Generated from plugins/builtin/shader-languages.js; sha256 bc252b339bd5d0965772147afaca2868ac8cb1a0774fd8a114430ee3533cd788. Do not edit. -->
**Interface, parsed from source** (plugins/builtin/shader-languages.js). Where the prose below it disagrees, this is the code.

```
  plugin     Shader Languages
  category   visuals
  needs      Materials
  points     1 panel
  commands   shader.languages (Shader languages)
             shader.list (Shaders and languages)
             shader.prefer (Prefer a language)
  arguments  shader.languages: none
  arguments  shader.list: none
  arguments  shader.prefer: language
  context    context.shaderLanguages
  listens    shell:ready
  emits      shader:swapped {moved}
  source     186 lines
```
