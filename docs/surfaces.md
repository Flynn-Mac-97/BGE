# The ways in

> One of the engine design docs — the index is [ARCHITECTURE.md](../ARCHITECTURE.md).

## Editor gestures

```
   drag in the viewport        ─┐
   type in the inspector       ─┤
   drop a type on the scene    ─┤
   drop a behaviour on a thing ─┼──▶  world  ──▶  writes to project/*.json
   create from + New           ─┤
   edit the file               ─┤
   CLI / window.engine         ─┘
```

The drop position decides what a drag means. A type dropped on empty space
places one; a behaviour dropped on an entity attaches to it. There are no tool
modes.

No save button anywhere. Every edit lands on disk immediately, which is what
lets the status bar say "saved" unconditionally.

One guard: **a simulated world refuses to save.** A level records where things
*start*; a run leaves the world holding where things *ended*, and writing that
back would overwrite the level with the run's end state.

## Driving it from outside

```
your terminal ──▶ bin/engine.mjs ──▶ POST /api/engine ──▶ ws ──▶ Terminal Bridge ──▶ window.engine
                              └────▶ --headless ──▶ startWorldInNode() ──▶ the same surface
```

Every CLI op is a method name on the engine surface, so the CLI cannot fall
behind it. Any command id also works as a verb, so a plugin that adds
`tests.run` has added a terminal command with it.

The bridge's transport is the dev server's existing websocket. No extra port, no
extra dependency, and it dies with the dev server.

`--headless` skips all of that and starts a world in the CLI process. It exists
so several agents can work at once: one dev server has one shared world;
headless worlds are one per process. Memory is private — world, clock, random
stream, selection. `project/` is not, because it is on disk, so anything that
*writes* still needs its own worktree or its own lane. Headless cannot draw;
for a frame, use a browser.

The engine hosts no AI. Any CLI can drive it.
