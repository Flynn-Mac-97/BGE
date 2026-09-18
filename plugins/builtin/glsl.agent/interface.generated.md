<!-- Generated from plugins/builtin/glsl.js; sha256 eb5914d543f96153abd8621775425472b71d85b35c1f5e90fc3176c12b7893d4. Do not edit. -->
**Interface, parsed from source** (plugins/builtin/glsl.js). Where the prose below it disagrees, this is the code.

```
  plugin     GLSL
  category   visuals
  needs      Shader Languages
  points     1 panel
  commands   glsl.backend (Whether GLSL can be built right now, and what to do if it cannot)
             glsl.forceWebGL (Ask the next page load for the WebGL backend, so GLSL can compile)
             glsl.list (Every GLSL shader, its inputs and its defaults)
             glsl.source (The GLSL source of one shader)
  arguments  glsl.backend: none
  arguments  glsl.forceWebGL: on
  arguments  glsl.list: none
  arguments  glsl.source: name
  context    context.glsl
  source     301 lines
```
