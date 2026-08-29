# How this engine works

Written for someone opening the project cold — a person or an agent. `README.md`
is how to *use* it; this is how it *works* and why it is shaped this way. This
file is the index: read it, then open the one design doc your task touches.

## The one idea

**Files on disk are the truth.** The editor, the CLI and `window.engine` are
three windows onto the same state, and all three write back to the same files.
There is no in-memory document that has to be saved, no project database, no
scene format that only the editor understands.

Two consequences that everything else follows from:

- Any change an agent can make with a text editor, the running engine will pick
  up. There is no engine-specific write API to learn.
- If it is not in a file, it is not happening. A behaviour you cannot find by
  reading `project/` does not exist.

## Shape

About 5,200 lines. Roughly half kernel, half plugins — and the plugins have no
privileges the kernel does not give everyone. Physics is a plugin; the
inspector is a plugin; delete both and the engine still boots. Everything above
`start-world.js` runs identically in the browser and headless.

Every name in this codebase is spelled out. `properties` not props, `context`
not ctx, `entity` not e, `seconds` not dt. Plugins are named the way you would
say them out loud — `Inspector Panel`, `Terminal Bridge`. Nobody reading this
code for the first time should have to decode it first, and that includes a
model reading it cold.

## The design docs

| Doc | What it owns |
|---|---|
| `docs/kernel.md` | the kernel modules, boot, the frame, and `context` — the one object |
| `docs/entity-model.md` | the flat entity, types and placements, behaviours, the runtime vocabulary |
| `docs/determinism.md` | the clock, the random stream, and why a run repeats |
| `docs/surfaces.md` | the ways in: editor gestures, the CLI, the bridge, headless |
| `docs/agent-workspace.md` | the instruction tree, packets, project overrides, live reload |
| `docs/design.md` | design rules the code follows, what is deliberately absent, known gaps |
