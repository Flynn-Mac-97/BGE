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


## Plugin and agent contracts

The loader now owns scoped plugin resources and compiles system schedules.
A plugin may also declare start-up work it cannot finish synchronously, through
`context.startup`; the world is not handed over until that work has settled.
Use `node bin/engine.mjs --headless run agent.commands '{"query":"profile"}'`
to discover command arguments, and `run agent.contracts` for service owners,
dependencies, lifecycle coverage and schedules. Reports are paginated.
Contracts and migration limits are documented in `docs/kernel.md`.

Plugin interfaces are generated files beside their guides. The server refreshes
them on source edits; packet readers check freshness and include the stored text
through the same file transport in the browser and headless worlds.