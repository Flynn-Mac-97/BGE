<!--e773e9df-->
parsed from source
  plugin Codemap
  category agents
  commands codemap.scan
  codemap.file
  codemap.system
  codemap.deps
  codemap.md
  arguments codemap.scan: options;codemap.file: options;codemap.system: options;codemap.deps: options;codemap.md: options
  input codemap.scan: { type: 'object', additionalProperties: false, properties: { ...DIRECTORY_PROPERTY } };codemap.file: { type: 'object', additionalProperties: false, required: ['file'], properties: { file: { type: 'string', description: 'a JavaScript file inside the checkout' } } };codemap.system: { type: 'object', additionalProperties: false, properties: { ...DIRECTORY_PROPERTY, locals: { type: 'boolean', description: 'include function-local variables' } } };codemap.deps: { type: 'object', additionalProperties: false, properties: { ...DIRECTORY_PROPERTY, root: { type: 'string', description: 're-root the tree at this module, relative to the scanned directory' }, depth: { type: 'number', minimum: 0, description: 'expand the tree this many levels; full when absent' }, symbols: { type: 'boolean', description: "show each module's classes, functions and exported constants" }, locals: { type: 'boolean', description: 'include function-local variables' } } };codemap.md: { type: 'object', additionalProperties: false, properties: { ...DIRECTORY_PROPERTY, locals: { type: 'boolean', description: 'include function-local variables' } } }
  source 201 lines
