# Systems Toolkit

This directory contains the reusable part of Systems Workspace. It does not import the engine, read a world, register a plugin, or execute inspected source. The engine adapter provides files and storage; this toolkit accepts plain data.

## Run outside this engine

Copy this directory to another JavaScript project, run `npm install` in it, then:

```sh
node cli.mjs analyze /path/to/source > graph.json
node cli.mjs brief design.json > implementation.md
```

The scanner ignores hidden directories, dependencies and common build output. It refuses scans over 1,200 files, 20 MB total or 2 MB per file. It does not follow symbolic links.

## API

```js
import { analyzeFiles, newDocument, applyEdit, implementationBrief } from './index.js'

const graph = analyzeFiles([
  { path: 'main.js', text: "import { run } from './logic.js'; run()" },
  { path: 'logic.js', text: 'export function run() {}' }
])
let design = newDocument('Feature proposal')
design = applyEdit(design, {
  type: 'add-node',
  node: { id: 'service', title: 'Service', kind: 'system', x: 40, y: 40 }
})
const brief = implementationBrief(design, graph.files)
```

`analyzeFiles` returns module nodes, imports, resolved imported-function calls, source locations, source fingerprints and findings. Files may include `scope` and `group`; paths resolve within each scope. JavaScript is parsed with Acorn. Relative imports, explicit re-exports and namespace imports are supported. Computed paths, arbitrary aliases, object dispatch and callback execution are not guessed. CommonJS `require` is a dependency edge; CommonJS export semantics are not resolved. Unsupported syntax is reported with the file. This is static analysis, not a runtime trace.

`newDocument`, `validateDocument` and `applyEdit` implement a version 1 JSON design with nodes, typed relationships, responsibility, inputs, outputs, constraints, decisions, acceptance criteria and optional source evidence. `documentFindings` reports missing design information, dependency cycles and stale evidence. `exportSVG`, `exportMermaid` and `implementationBrief` produce portable deliverables.

`flowFromSource(source, functionStart)` parses one function into start/code/if/while/return nodes. `applyFlowToSource(source, flow)` validates and replaces only that function's range. The surrounding module remains intact. Named ports are `next`, `yes`, `no`, `after` (branch join) and `body` (while body); a while body connects back to the while node. Other JavaScript statements remain explicit code blocks. Comments are retained, although their placement and formatting within the edited function may change. Disconnected flow nodes and unstructured cycles are refused. Generator functions are not converted.

## Storage contract

The toolkit performs no writes. A host should validate designs, store versioned JSON atomically, check the expected saved revision, keep recovery copies, and guard source writes with the exact source hash. Never treat a design draft as proof that code already implements it.
