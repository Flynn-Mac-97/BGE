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

**Every call names its target.** One dev server can have several pages attached
— the person's editor and one headless page per lane — so a call carries
`--client <id>` and reaches that page alone. With two or more attached, an
untargeted call is refused with the list rather than broadcast; the fastest page
to answer is not the right one. Every reply says which page answered, and an
answer from a page the caller did not name fails the call. Two pages cannot hold
one name: the second is refused, and only the page's own nonce — kept in its
session storage across reload — separates a reconnect from an impostor.

## The work lock

While lanes work, the shared checkout has one writer at a time. The lock is
derived, never stored: an active run in the agent registry, or a lane browser
whose process is still alive. Nothing has to remember to unlock.

- A **lane's render page** is refused every op that writes a file, always. Its
  world is its own; the checkout is shared.
- The **person's editor** is refused every writing op while a lane works. Reads
  answer as usual, and the refusal names the lanes.
- Which of the two a caller is comes from the lane browser registry, never from
  what the page reports about itself. A page can set `navigator.webdriver` or
  its user agent; it cannot write a registry entry.

`engine/work-lock.mjs` decides and enforces nothing. It is enforced in three
places, and a write reaching disk any other way is not covered by any of them:

- `vite.config.js`, at all three server write doors — `POST /api/engine`,
  `POST /api/file` and `POST /api/agent-file` — each answering
  `423 {code:"held"}`.
- `engine/files.js`, a kernel guard, so a lane's page refuses its own write
  before it reaches the wire.
- `engine/start-world-node.mjs`, a guard on the node file transport, so a
  `--headless` run refuses a write to a project file and the CLI exits 1.

`node bin/engine.mjs lock` says who holds it.

Two writes are deliberately outside the lock: a capture written to
`agent-runs/`, because measuring a lane while it works is the point, and
`engine/agent-workspace-node.mjs`, which writes the run registry the lock is
derived from.

`--headless` starts a world in the CLI process instead of talking to a server,
and carries the lock with it. It exists so several agents can work at once: one
dev server has one shared world; headless worlds are one per process. Memory is
private — world, clock, random stream, selection. `project/` is not, because it
is on disk, so anything that *writes* still needs its own worktree or its own
lane. Headless cannot draw; for a frame, use a browser.

The engine hosts no AI. Any CLI can drive it.
