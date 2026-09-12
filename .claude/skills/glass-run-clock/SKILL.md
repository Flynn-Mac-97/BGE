---
name: glass-run-clock
description: Times a run from first step to end and reports why it ended. Use for survival timers, run summaries, died or survived outcomes, and the numbers a results screen shows.
---
<!-- generated from plugins/builtin/run-clock.agent.md at server start; edits are lost -->

# Run Clock

- A run starts, is timed, and ends. Engine time, so a paused level-up does not
  count as time survived.
- Starts itself on the first fixed step, so `simulate()` times a run exactly as
  pressing play does. `begin()` and `end(reason)` are there when a game wants them.
- context.runClock.watch(entity | id | () => entity)` ends the run when that thing
  leaves the world or its `properties.health` drops to zero. Reason: `died`.
- context.runClock.limit(seconds)` ends it by itself. Reason: `survived`.
- context.runClock.report('kills', () => count)` adds a number to the result.
- `summary()` is `{ seconds, clock: '12:34', reason, over, ...reports }`, and
  is sent with `run:ended`. Also `run:started`.
- Ending **holds** the world (`loop.hold('run-over')`) rather than stopping it,
  so a result screen still draws.
- The words on a result screen belong to the game. This plugin writes none.
- Mirrors `runSeconds`, `runClock` and `runOver` into `world.state`.
- Commands: `run.state`, `run.end <reason>`.
