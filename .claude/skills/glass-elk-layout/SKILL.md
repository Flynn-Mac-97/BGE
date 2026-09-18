---
name: glass-elk-layout
description: Reusable ELK graph arrangement service for browser and headless plugins.
---
<!-- generated from plugins/builtin/elk-layout.agent.md at server start; edits are lost -->

Read the generated interface in `plugins/builtin/elk-layout.agent/interface.generated.md`. Plugin edits refresh it while the server runs. This packet command also checks freshness:

```sh
node bin/engine.mjs agent.context '{"task":"…","files":["plugins/builtin/elk-layout.js"]}'
```

# ELK Graph Layout

- Declare `requires: ['graph.layout']`; get it with `scope.require('graph.layout')`.
- `await service.arrange({nodes,edges})` returns new nodes with positions and new edges with orthogonal sections and port IDs. Input is not changed.
- Nodes carry `id,width,height` and optional function records. Edges carry `id,from,to`; optional source evidence and target lines attach calls to function rows.
- Uses layered left-to-right arrangement and fixed ports. No DOM is needed. Disabling the provider refuses pending results and future calls.
- Package: `elkjs` (EPL-2.0). The library loads on the first arrange call.
