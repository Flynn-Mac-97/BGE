---
name: glass-history
description: History — Photoshop's history palette: `history.undo` (ctrl+z), `history.redo` (ctrl+shift+z), `history.jump <index>`, `history.list`, `history.clear`. An entry is a snapshot of `world.toLevel()`, ...
---
<!-- generated from plugins/builtin/history.agent.md at server start; edits are lost -->

# History

- Photoshop's history palette: `history.undo` (ctrl+z), `history.redo` (ctrl+shift+z), `history.jump <index>`, `history.list`, `history.clear`.
- An entry is a snapshot of `world.toLevel()`, not a diff — nothing routes edits through a command.
- Captured on `world:changed` and on `files:written` for the open level; a drag and an arrow nudge only save, so both signals are needed.
- Never captured while playing, simulated, or loading. Three flags, not one: `play:started` fires and every `start` hook runs BEFORE the loop starts and before `world.simulated` is set, so a hook that spawns would otherwise file one entry per spawn.
- Consecutive changes with the same verb on the same ids merge into one entry. A different entity, a new selection, a step back or a level load starts a new one.
- A reload of the open level is filed as its own step, `Reloaded <level>`, never merged into the entry before it — otherwise the step that recorded a move comes to record not moving.
- Stepping rebuilds the world and calls `context.save()`; ids are preserved. `editor.loadLevel` is not used — it reads disk and refuses a simulated world.
- A step is exactly as lossy as reopening the level: it replays the placements `toLevel` would have written. Anything a placement does not carry does not come back — `hidden`, ad-hoc fields written by `engine.set`, runtime behaviour state.
- Undo refuses while playing (`{ skipped: 'playing' }`) and while a step is still writing (`{ skipped: 'busy' }`).
- `DEPTH = 50` steps, in memory, this session. On overflow the oldest is dropped, so `Opened` falls off the list.
