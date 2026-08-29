# Determinism

> One of the engine design docs — the index is [ARCHITECTURE.md](../ARCHITECTURE.md).

`simulate()` is only useful if it repeats. The engine owns every source of
nondeterminism so game code has nowhere else to get one:

| Not available to game code | Use |
|---|---|
| `performance.now()` `Date.now()` `new Date()` | `context.time` |
| `Math.random()` | `context.random()` |
| `setTimeout` `setInterval` | `context.after(s, fn)` `context.every(s, fn)` |
| `requestAnimationFrame` | the `update` hook |

`node bin/engine.mjs check` fails on any of the left column, with file and line.

Engine time is derived from an integer step count, not accumulated — adding
`1/60` fifteen times does not land on `0.25`, and a timer set for exactly `0.25`
would fire a step late. Loading a level resets clock, schedule and random stream
together; resetting only some of them is the subtle version of the same bug.
