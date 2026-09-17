---
description: Code-derived system inspection, editable architecture drafts, AI implementation briefs and visual JavaScript scripting.
match: ["plugins/builtin/systems-inspector/**", "plugins/builtin/systems-inspector.js"]
---
# Systems Workspace

- Requires `editor.code` (Monaco Code Editor), `editor.diagram` (JointJS Diagrams), and `graph.layout` (ELK Graph Layout). The loader owns their dependency order and disable cascade. Browser views and styles are local to this plugin.
- ELK arranges calls; JointJS draws file compartments with clickable function rows; Monaco shows and edits source. Call arrows describe source structure, not runtime order.
- Diagram defaults to Program Flow: the HTML entry script, invoked local entry function, and direct startup calls in evaluation order. Callback bodies and utilities are omitted. Branching entries report a limit. `systems.filter {diagramView:'files'}` switches to File Relationships; `'modules'` shows Architecture; `'program'` restores startup flow.
- Architecture groups the scoped files into parts and draws imports between them. A part is a large module (or a widely-imported utility); smaller files fold into the largest module they import; plugins stay separate. Select a part to read its main file.
- Diagram, Code, Design and Visual Script are permanent navigation links. `systems.mode` accepts `inspect`, `code`, `design`, `script`; `#systems=<mode>` reopens that mode. Anonymous callback rows are hidden by default; `systems.filter {showCallbacks:true}` reveals them without changing call edges.

- Open SYSTEMS. Inspect code filters engine, builtin plugins, game plugins or all source; selecting nodes keeps call lines on the map. Analysis never executes source. Dynamic calls remain unresolved.
- A Program Flow step opens at its call site; `Open definition` jumps to the resolved function. The source function selector reveals a function; `systems.focusFunction` takes its start offset. Code keeps scope, search and the file list; relationship controls stay in Diagram.
- Design edits nodes, groups, contracts, decisions and acceptance criteria. Save versioned JSON under project `.engine/systems/`; conflicts retain the draft. Source evidence detects drift. Export JSON, SVG, Mermaid or an AI brief.
- Visual scripting edits one JavaScript function with code/if/while/return nodes. Preview validates before Apply. Named ports: next, yes, no, after (join), body. Source writes check the original hash and retain `.systems-backup`; other source ranges are preserved.
- The toolkit is host-independent. Read `plugins/builtin/systems-inspector/toolkit/README.md` for portable APIs, schemas and supported syntax. Local recovery covers unsaved drafts and code buffers.
- `systems.filter` accepts scope, relation and search. `systems.design.edit` accepts a portable edit record; `.export` takes json, svg, mermaid or brief. `systems.script.open` takes a function start offset; `.connect` takes from, to, port. Legacy flow commands remain engine-specific.

## Commands

`systems.scan`, `systems.workspace`, `systems.graph`, `systems.filter`, `systems.inspect`, `systems.inspectEdge`, `systems.analyze`, `systems.design.new`, `systems.design.list`, `systems.design.open`, `systems.design.restore`, `systems.design.edit`, `systems.design.save`, `systems.design.saveCopy`, `systems.design.discard`, `systems.design.undo`, `systems.design.redo`, `systems.design.import`, `systems.design.export`, `systems.design.fromCode`, `systems.focusFunction`, `systems.script.open`, `systems.script.edit`, `systems.script.add`, `systems.script.connect`, `systems.script.preview`, `systems.source.edit`, `systems.source.apply`, `systems.connections`, `systems.calls`, `systems.function`, `systems.callSite`, `systems.definition`, `systems.back`, `systems.line`, `systems.open`, `systems.close`, `systems.map`, `systems.fullscreen`, `systems.flow`, `systems.phase`, `systems.select`, `systems.expand`, `systems.source`, `systems.refresh`
