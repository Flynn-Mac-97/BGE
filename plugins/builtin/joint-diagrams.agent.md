---
description: Reusable lazy-loaded JointJS diagram service for plugin panels.
match: ["plugins/builtin/joint-diagrams.js", "plugins/builtin/joint-diagrams/**"]
---
# JointJS Diagrams

- Declare `requires: ['editor.diagram']`; get it with `scope.require('editor.diagram')`.
- `await service.ready()` loads JointJS. `service.create({nodes,edges,view,editable,selected,selectedEdge,onSelect,onFunction,onEdge,onMove})` returns a DOM element.
- Nodes carry `id,title,x,y,width,height` and optional `group,functions`. Function records carry `name,line,start,endLine`. Edges carry `id,from,to,label`, with optional ELK `sourcePort,targetPort,sections`.
- The consumer owns saved data and undo. Callbacks report selections and moves. Mounts dispose papers and event handlers when removed or disabled.
- Package: `@joint/core` (MPL-2.0). Uses open-source shapes and paper APIs; no JointJS+ dependency.
