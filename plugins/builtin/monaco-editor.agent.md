---
description: Reusable lazy-loaded Monaco editor service for plugin panels.
match: ["plugins/builtin/monaco-editor.js", "plugins/builtin/monaco-editor/**"]
category: authoring
---
# Monaco Code Editor

- Declare `requires: ['editor.code']`; get it with `scope.require('editor.code')`.
- `await service.ready()` loads Monaco. `service.create({value,path,line,readOnly,files,onChange})` returns a DOM element. `path` uses `scope/path`; optional files are `{scope,path,text}` records for language support.
- The consumer owns its text buffer, validation and disk writes. `onChange(text)` never writes a file.
- Mounts dispose editors and models when removed. Disabling the provider also terminates workers. Headless callers may discover the service; creating an editor requires a browser.
- Package: `monaco-editor` (MIT). Assets and workers are bundled locally by Vite.
