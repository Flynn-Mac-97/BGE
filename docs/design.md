# Design rules and gaps

> One of the engine design docs — the index is [ARCHITECTURE.md](../ARCHITECTURE.md).

## Design rules the code follows

- **One accent colour means one thing.** In the editor it means "changed" — an
  override, a problem. Nothing else may spend it.
- **Two trees need two verbs.** The Scene panel *selects*; the Project panel
  *opens*. Ambiguity between them was a real bug, fixed by naming the verb in
  the panel title.
- **Plugins never write markup.** They compose from `ui.*`. A plugin therefore
  cannot pick a colour and cannot drift from the design system. When a built-in
  panel needed dim metadata text twice, the fix was to add `ui.meta`, not to
  reach for raw DOM.
- **Failure is contained by name.** A plugin that throws is disabled with its
  name and reason reported; it cannot take the editor down.
- **Silence is the enemy** — never fail without saying so. A missing texture
  falls back to a flat colour *and* reports itself. A blank viewport with an
  empty error log gives an agent nothing to act on. Code cites this rule by
  name.

## What is deliberately not here

- No component system, no `GetComponent`, no archetypes, no execution order to
  configure. Behaviours compose, but they cannot query each other, and an
  entity stays flat.
- No scene format beyond JSON placements.
- No editor state that is not either in a file or trivially recomputed — with
  one exception, `History`. It holds this session's past states of the level in
  memory, neither on disk nor recomputable. The level on disk stays the truth:
  every step writes it.
- No CSS in game code. The editor is styled by `engine/style.css`; a game draws
  into the canvas.

## Known gaps

The runtime is much thinner than the tooling. Missing: tilemaps and bulk
placement, scene flow between levels, saving game state, parenting, gamepad and
touch input, time scale, and any way to export a playable build.

Three things have come off this list. Check the code before putting one back:

- **3D model loading.** `mesh: { model: '<file>.glb' }` loads a GLB and
  `entity.pose` swings its named nodes. GLB crowds do not instance yet, which is
  the current cost of using them for enemies.
- **Rig animation.** `Rig Animation` plays a baked clip of rotations onto those
  named nodes, bones included. `tools/make-rig-clip.mjs` bakes one from text
  through kimodo.cpp. There is no blending between clips.
- **Raycasts.** `context.raycast(origin, direction, maxDistance, { ignore, hit })`
  returns the nearest entity with a 3D collider box, plus the point, the face
  normal and the distance. Physics 3D registers it, and `run physics3d.raycast`
  casts one from a terminal.
- **Triggers separate from solids.** `properties.body: 'trigger'` reports
  contacts through `onCollide` and pushes nothing. Only `body: 'solid'` blocks,
  and only `body: 'dynamic'` is moved; both physics plugins agree on that.

Frame-phase systems only run while the world is playing, so anything drawn by
one — particles, damage numbers — is invisible in edit mode. An effect can only
be checked by pressing play.

Pause is now in the kernel: `loop.hold(reason)` stops the clock while every
system and update still runs with a step of zero seconds, so a screen drawn over
a frozen world still draws and still reads keys. `loop.release(reason)` gives it
back, and holds are counted by name so two holders cannot start the world under
one another.

Time scale has one piece of it now: `loop.holdFor(seconds)` skips whole fixed steps
for hit stop, and `Impact` drives it. A pause and a general slow-motion are
still not there, and a fractional time scale would need the fixed step to stop
being fixed, which changes every determinism guarantee at once.

The game also runs in the editor's own page, so an infinite loop in game code
freezes the editor — though `--headless` now gives you somewhere else to run it.

Two editor tabs on one dev server both answer the bridge and the first reply
wins, so a state-dependent CLI call can read the other tab's world. Keep one tab
open per server, and use `--headless` when you want more than one world. Across
servers this is now fenced: every bridge reply names the checkout it serves and
the CLI refuses a mismatch.

`History` covers the editor's own edits, not everything. A step is exactly as
lossy as reopening the level — it replays the placements `toLevel` would have
written — so `hidden`, ad-hoc fields set by `engine.set`, and runtime behaviour
state do not come back. It is also session-only: reloading the page loses it.

Parallel agents are separated by claim and by worktree, but `Claim Guard` reads
the registry once at boot and only on the node side, so a run that starts
mid-session is not seen and the browser guards nothing. `npm test` still cannot
run in a lane — it needs the one dev server and the one editor tab — so it is
deferred to `agent.merge`.
