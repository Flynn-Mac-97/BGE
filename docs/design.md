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
- **Silence is the enemy.** A missing texture falls back to a flat colour *and*
  reports itself. A blank viewport with an empty error log is the worst thing
  the engine can hand an agent.

## What is deliberately not here

- No component system, no `GetComponent`, no archetypes, no execution order to
  configure. Behaviours compose, but they cannot query each other, and an
  entity stays flat.
- No scene format beyond JSON placements.
- No editor state that is not either in a file or trivially recomputed.
- No CSS in game code. The editor is styled by `engine/style.css`; a game draws
  into the canvas.

## Known gaps

The runtime is much thinner than the tooling. Missing: tilemaps and bulk
placement, scene flow between levels, saving game state, parenting, raycasts,
triggers separate from solids, particles, gamepad and touch input, pause and
time scale, 3D model loading, and any way to export a playable build.

The game also runs in the editor's own page, so an infinite loop in game code
freezes the editor — though `--headless` now gives you somewhere else to run it.

Two editor tabs on one dev server both answer the bridge and the first reply
wins, so a state-dependent CLI call can read the other tab's world. Keep one tab
open, and use `--headless` when you want more than one world.
