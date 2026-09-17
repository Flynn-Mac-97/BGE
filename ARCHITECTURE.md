# How this engine works

Written for someone opening the project cold — a person or an agent. `README.md`
is how to *use* it; this is how it *works* and why it is shaped this way. This
file is the index: read it, then open the one design doc your task touches.

## The one idea

**Files on disk are the truth.** The editor, the CLI and `window.engine` read
and write the same files. There is no in-memory document to save, no project
database, no scene format only the editor understands.

Two consequences that everything else follows from:

- Any change an agent can make with a text editor, the running engine will pick
  up. There is no engine-specific write API to learn.
- If it is not in a file, it is not happening. A behaviour you cannot find by
  reading `project/` does not exist.
- An unsaved project is unnamed, not held in memory. The editor opens the
  untitled project, a real directory, and naming it moves the directory. There
  is still nothing to save.

The game is not in this repository. A project is a directory anywhere on disk,
named by `ENGINE_PROJECT` or `--project`, and the engine calls whichever one is
open `project/` — in a URL, in a `match:` pattern, and in every path in these
docs. `docs/kernel.md` says how that one name reaches a directory anywhere.

## Shape

About 5,200 lines. Roughly half kernel, half plugins — and the plugins have no
privileges the kernel does not give everyone. Physics is a plugin; the
inspector is a plugin; delete both and the engine still boots. Everything above
`start-world.js` runs identically in the browser and headless.

Every name is spelled out: `properties` not props, `context` not ctx, `entity`
not e, `seconds` not dt. Plugin names are plain Title Case — `Inspector Panel`,
`Terminal Bridge`. A short name saves nothing and costs the reader a decoding
step.

## The design docs

| Doc | What it owns |
|---|---|
| `docs/kernel.md` | the kernel modules, boot, the frame, and `context` — the one object |
| `docs/entity-model.md` | the flat entity, types and placements, behaviours, the runtime vocabulary |
| `docs/determinism.md` | the clock, the random stream, and why a run repeats |
| `docs/surfaces.md` | the ways in: editor gestures, the CLI, the bridge, headless |
| `docs/agent-workspace.md` | the instruction tree, packets, project overrides, live reload |
| `docs/design.md` | design rules the code follows, what is deliberately absent, known gaps |


## Systems Inspector

Open **SYSTEMS** in the editor toolbar to inspect Engine Core separately from Plugins.
Expand fixed/frame systems in their registered order and select a node to read code.
Entity updates expand into representative loaded types and their behaviour hooks.
The kernel outline is a teaching view; plugin children come from the live registry.
This is scheduled flow, not an execution trace. Source access is read-only.
Commands and limits: `plugins/builtin/systems-inspector.agent.md`.

Systems Inspector opens across the editor window. **Systems Map** shows core modules and labelled relationships, with plugins grouped separately. Simulation and presentation remain separate views. Use **Dock view** or **Close** to return to the editor.

**Function calls** in the Systems Inspector parses the selected full source file. Select a function to inspect calls and file-local callers, jump to call-site lines, or follow local definitions and direct relative imports. Dynamic calls are marked unresolved. This does not record runtime execution.

Select a module in Systems Map to highlight its connections while keeping the full map visible. Call lines link resolved imported functions, labelled caller → function; arrows open call sites. Import lines is a separate mode.

The core map inventories index.html and all engine/ JavaScript, MJS and CSS sources from disk. It marks engine/index.js as browser main and draws literal imports. Hover or select a file to highlight its connections. Selection opens source beside the map; Local function detail is optional.

## Systems Workspace: inspection, design and visual scripting

Systems Inspector consumes three ordinary scoped plugins: Monaco Code Editor (`editor.code`), JointJS Diagrams (`editor.diagram`), and ELK Graph Layout (`graph.layout`). The loader orders these services and disables the consumer before a provider. Their libraries load on demand. Monaco owns editor models and workers; JointJS owns diagram papers; the consumer owns source buffers, validation and disk writes. The workspace view and its styles are in the Systems Inspector plugin, not the kernel UI.

ELK arranges source calls with fixed ports at function rows and returns orthogonal routes. JointJS renders file compartments and interactions. Layout requests discard stale scan results. Headless sessions register the same services without loading browser editors, and can use ELK to arrange graphs.

SYSTEMS opens a fullscreen workspace. Inspect code scans source files across engine, builtin plugins and game plugins. The graph follows parsed imports and resolved function calls; it never executes source. Filter by source group or file, select nodes and call sites, and inspect coupling, cycles and unresolved code.

Design mode creates editable architecture drafts with typed nodes, connections, responsibility, inputs, outputs, constraints, decisions and acceptance criteria. Save and reopen project-local versioned diagrams; use undo/redo, JSON import, SVG/Mermaid export or an AI implementation brief. A source-linked draft reports changed evidence after a scan.

Visual scripting converts one selected JavaScript function into code, condition, while and return nodes. Preview validates the flow before Apply writes that function back. Arbitrary statements remain code blocks; generators remain source-only. Source writes check the original hash, retain a backup, and preserve surrounding code. Invalid or conflicting changes remain editable.

The host adapter and UI are separate from `plugins/builtin/systems-inspector/toolkit/`, a plain-data library with a standalone source-scanning CLI. Its README documents reuse outside the engine. Diagrams are stored under the game's `.engine/systems/`, with optimistic revision checks and one previous saved revision.


## Plugin and agent contracts

The loader now owns scoped plugin resources and compiles system schedules.
A plugin may also declare start-up work it cannot finish synchronously, through
`context.startup`; the world is not handed over until that work has settled.
Use `node bin/engine.mjs --headless run agent.commands '{"query":"profile"}'`
to discover command arguments, and `run agent.contracts` for service owners,
dependencies, lifecycle coverage and schedules. Reports are paginated.
Contracts and migration limits are documented in `docs/kernel.md`.
