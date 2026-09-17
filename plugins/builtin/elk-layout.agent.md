---
description: Reusable ELK graph arrangement service for browser and headless plugins.
match: ["plugins/builtin/elk-layout.js", "plugins/builtin/elk-layout/**"]
---
# ELK Graph Layout

- Declare `requires: ['graph.layout']`; get it with `scope.require('graph.layout')`.
- `await service.arrange({nodes,edges})` returns new nodes with positions and new edges with orthogonal sections and port IDs. Input is not changed.
- Nodes carry `id,width,height` and optional function records. Edges carry `id,from,to`; optional source evidence and target lines attach calls to function rows.
- Uses layered left-to-right arrangement and fixed ports. No DOM is needed. Disabling the provider refuses pending results and future calls.
- Package: `elkjs` (EPL-2.0). The library loads on the first arrange call.
