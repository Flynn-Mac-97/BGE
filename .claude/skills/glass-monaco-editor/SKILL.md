---
name: glass-monaco-editor
description: Reusable lazy-loaded Monaco editor service for plugin panels.
---
<!-- generated from plugins/builtin/monaco-editor.agent.md at server start; edits are lost -->

Read the generated interface in `plugins/builtin/monaco-editor.agent/interface.generated.md`. Plugin edits refresh it while the server runs. This packet command also checks freshness:

```sh
node bin/engine.mjs agent.context '{"task":"…","files":["plugins/builtin/monaco-editor.js"]}'
```

# Monaco Code Editor

- Declare `requires: ['editor.code']`; get it with `scope.require('editor.code')`.
- `await service.ready()` loads Monaco. `service.create({value,path,line,readOnly,files,onChange})` returns a DOM element. `path` uses `scope/path`; optional files are `{scope,path,text}` records for language support.
- The consumer owns its text buffer, validation and disk writes. `onChange(text)` never writes a file.
- Mounts dispose editors and models when removed. Disabling the provider also terminates workers. Headless callers may discover the service; creating an editor requires a browser.
- Package: `monaco-editor` (MIT). Assets and workers are bundled locally by Vite.
