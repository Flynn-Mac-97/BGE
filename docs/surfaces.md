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

Where you let go of a drag is the whole gesture. A type dropped on empty space
places one; a behaviour dropped on an entity attaches to it. Nothing to arm,
no mode to leave.

No save button anywhere. Every edit lands on disk immediately, which is what
lets the status bar say "saved" unconditionally.

One guard: **a simulated world refuses to save.** A level records where things
*start*; once the simulation has run the world holds where things *ended*, so
writing it back would replace the level with a freeze-frame of a playthrough.

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
so several agents can work at once: one dev server has one world, and ten agents
stepping it trample each other, while ten headless worlds never meet. Memory is
private — world, clock, random stream, selection. `project/` is not, because it
is on disk, so anything that *writes* still needs its own worktree or its own
lane. Headless cannot draw; when you need a frame, use a browser.

The engine hosts no AI. It opens a door; whichever CLI you run walks through it.
