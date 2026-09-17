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
                              └────▶ --headless ──▶ startWorldInNode() ──▶ one op, then exit
                              └────▶ serve ────────▶ startWorldInNode() once, then one op per line
```

Every CLI op is a method name on the engine surface, so the CLI cannot fall
behind it. Any command id also works as a verb, so a plugin that adds
`tests.run` has added a terminal command with it.

`--headless` builds a world, answers one op and exits, so an agent that looks,
decides and looks again pays a boot for every question. `serve` holds that world
open and reads one JSON request per line on stdin, answering one JSON line each.
An op there is a method on the engine or a dotted path to one — `editor.loadLevel`,
`loop.step` — so one session can change level rather than needing one per level.
Twenty questions cost 6.1 s as twenty `--headless` invocations and 0.3 s in one
session, and the marginal cost of a later question is under a millisecond.

**A headless run exits with the code its answer deserves**, and it ends by draining
rather than by calling `process.exit()`. A world that has stepped a Rapier body leaves
the runtime with a handle still closing, and exiting under it asserts inside libuv on
Windows — which reported a crash for every run that worked. A run that entered play
mode has its frame driver stopped before the code is set, because that timer would
otherwise hold the process open. Both halves matter: see `p321` in the pain ledger.

The bridge's transport is the dev server's existing websocket. No extra port, no
extra dependency, and it dies with the dev server.

## What a reply costs to read

Every reply is JSON, and the reader is usually an agent paying by the token, so a
list names its columns once instead of repeating the names on every row.

```
snapshot --entities                       every entity, every field, as rows of objects
snapshot '{"entities":["id","at"]}'       the same entities as two columns
commands '{"fields":["id"]}'              every verb, one column
```

A four-hundred-and-forty-entity level is 22,231 characters as rows and 10,422 as
`id` and `at` — 5,558 tokens against 2,606. `commands` is 21,936 against 4,246 for
`["id"]`, and both lists hold the same data. `--entities` on its own is unchanged,
because a caller already written against it keeps its answer.

A field the row does not carry is refused rather than answered with a column of
nulls, and the refusal names the fields that exist. A column of nulls reads as a
world where nothing has a rotation.

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
and carries the lock with it. `serve` is that same world held open, under the
same guard. It exists so several agents can work at once: one
dev server has one shared world; headless worlds are one per process. Memory is
private — world, clock, random stream, selection. `project/` is not, because it
is on disk, so anything that *writes* still needs its own worktree or its own
lane. Headless cannot draw; for a frame, use a browser.

The engine hosts no AI. Any CLI can drive it.
