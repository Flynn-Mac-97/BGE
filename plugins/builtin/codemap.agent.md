---
match: engine/** plugins/** bin/** test/** scripts/** tools/** electron/**
triggers: codemap, map, structure, structural, codebase, architecture, dependency, dependencies, module graph, module map, system map, dependency tree
skill: none
---

# Codemap

Ask for a map before reading whole files. Codemap reads this checkout's own
JavaScript with tree-sitter and answers five views. Reading source needs node,
so call it with `--headless`.

- `node bin/engine.mjs --headless run codemap.scan` — every file's symbols,
  imports, exports and dependency edges, as JSON. Narrow it with
  `'{"directory":"engine"}'`.
- `node bin/engine.mjs --headless run codemap.file '{"file":"engine/world.js"}'`
  — one file's structure, as JSON.
- `node bin/engine.mjs --headless run codemap.system` — modules as boxes grouped
  by dependency layer, each carrying its classes, functions and dependencies.
  Add `'{"locals":true}'` for function-local variables.
- `node bin/engine.mjs --headless run codemap.deps '{"root":"bin/engine.mjs","depth":2,"symbols":true}'`
  — the module dependency tree from its entry points. `depth` cuts the
  expansion, `symbols` adds each module's shape, `root` re-roots the tree.
- `node bin/engine.mjs --headless run codemap.md` — a markdown report of every
  file and its symbols.

The last three answer `{ "view": "...", "text": "..." }`. A `directory` is
always inside this checkout.
