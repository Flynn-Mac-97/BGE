<!-- Generated from plugins/builtin/plugin-master.js; sha256 c8d2151ccfc53eca99930de2839852624a9607d51196fcab91b8f75eb54d6834. Do not edit. -->
**Interface, parsed from source** (plugins/builtin/plugin-master.js). Where the prose below it disagrees, this is the code.

```
  plugin     Plugin Master
  category   engine
  commands   plugin.sizes (Measure every plugin against the size rule)
             plugin.facts (Describe a plugin from its source, and list every derived description)
  arguments  plugin.sizes: none
  arguments  plugin.facts: options = {}
  input      plugin.facts: { type: 'object', additionalProperties: false, properties: { plugin: { type: 'string', description: 'one plugin name; omit for every plugin' } } }
  source     268 lines
```
