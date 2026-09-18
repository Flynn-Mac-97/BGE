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

## Input is recorded, not owned

Input is the one source that arrives from outside, so it cannot be replaced by
something deterministic — it is written down instead. The loop records every press
and release against the step count it arrived at, and the Keyboard Input plugin is
the browser events and the action names laid over that record.

Two things follow. A run can be played again from its own record, which is what
makes a rewind or a restored world checkable rather than hopeful. And `pressed`
means one step in both halves: it used to be cleared on the frame phase, so a
headless `step(600)` left it true for all six hundred steps while a browser cleared
it sixty times a second — one run, two answers.

A level load clears the record with the clock, so two runs of one level begin with
the same empty input. A key held across a reload is let go of deliberately: a run
that opened with a key already down would not begin the same way twice.

Engine time is derived from an integer step count, not accumulated — adding
`1/60` fifteen times does not land on `0.25`, and a timer set for exactly `0.25`
would fire a step late. Loading a level resets clock, schedule and random stream
together; resetting only some of them is the subtle version of the same bug.

## Comparing two runs

`snapshot()` carries `hash`: a 32-bit number over everything an entity carries —
its transform, its velocity, its animation frame, the game properties on it and
each attached behaviour's own bag — plus the shared game state. Everything except
the entity's type definition is folded, so a field a plugin adds later is in the
number without anyone remembering to add it here.

Two runs of one level at one seed are compared by that single value instead of by
reading a thousand entities, and a rewind or a restored world is proved exact by
it rather than eyeballed. It reads the world as it stands and not how it got
there, so a level loaded again reads the same as one never played. Two worlds in
one process agree as well as two processes do, which is the shape a headless
fan-out has.

Every value goes in as its own bits, and a list is walked rather than converted:
`Number([16, 1, 1])` is `NaN`, and every `NaN` is the same `NaN`, so a scale or a
rotation written as a vector would fold to one constant and the hash would be
blind to it — two worlds differing only in a turned body would read alike.

**A level load does not clear `world.state`.** The entities, the clock, the
schedule and the random stream reset together; the shared state belongs to the
game, so a plugin resets what it owns when it hears `level:loaded`. Anything that
captures or restores a world has to carry it, because nothing else will put it
back.

A hash costs about two microseconds an entity — 11 ms on a five-thousand-entity
level — and `snapshot()` is taken on demand rather than per frame, so it is worth
folding everything rather than a list that would quietly fall behind.

## A rewind

`context.capture()` takes a moment of the run and `context.restore(moment)` puts it
back, so an agent can step forward, look, and step back to where it was instead of
starting the level again.

The world's entities are only a third of it. The clock, the seed and its draw
count, the keys that were down, the named holds and the hit stop all belong to the
loop, and a solver keeps its own state outside both. Each one is measured as
load-bearing: restoring the entities and the solver but not the loop leaves a world
that looks right and runs wrong from the next step, and so does the other way
round.

`stateHash` proves the result. A rewind is exact when fifty steps taken from the
moment land on the same hash as the fifty steps that already happened — not when
the entities match, which a rewrite of the entity fields answers on its own.

A plugin holding state of its own declares it in `onLoad` with
`context.checkpoints.add`, and a plugin that will not go back is named. What cannot
be carried is named in `moment.lost`: a scheduled callback is a closure, so a
checkpoint holding one can only say how many it could not keep.

A full restore clears the timer schedule, including timers created after capture.
Captured callbacks remain listed in `lost`; a clock-only reload can retain its
rebuilt schedule. Solver checkpoints store entity ids and body handles alongside
the bytes. Entities restore first so solvers can bind bodies to revived entities.

## Stepping back

`engine.stepBack(n)` and `engine.seek(step)` put the run back, and `engine.marks`
says how far back it can go. The ring keeps the last two minutes of the run as
moments, one every sixty steps, because a moment costs about 0.17 ms and 78 KB in a
scene with forty Rapier bodies in it. Going to a count between two marks puts the
earlier one back and steps the rest of the way — exact, and it costs the steps in
between. `engine.mark()` takes one by hand, for the moment worth returning to
exactly.

Measured on 41 Rapier bodies: observing each step costs 0.05 µs, a mark 0.17 ms, and
the two together are 1.6% of a step with the mark spread over its stride. A seek of
thirty steps costs 17 ms, most of it the solver going back rather than the replay. On
a scene with no solver a step is 6 µs and a seek is 1.3 ms.

**The rewind replays the keys the run was played with.** A mark taken at step sixty
cannot hold a key released at step seventy — the mark was taken before that
happened — so a seek hands the loop the timeline it has, and the loop applies
recorded events at the count they were stamped for. Without that, a rewind of a
played run is a rewind of a world nobody touched, and it diverges at the first key.
A key pressed after a rewind voids the recorded future: those events belong to a run
that no longer happens.

A key is `pressed` for exactly one step, both live and replayed: a live press is
applied where it arrives and counts as applied, and a replayed one is applied at the
count it was stamped for.

**The compiled solver is shared between worlds; the solver is not.** Rapier's
megabytes of WebAssembly are compiled once for the process, and each world builds
its own Rapier world over it. One bridge over two worlds made every step reconcile
against one entity list and drop the other world's bodies, so two worlds stepped
side by side answered differently from the same worlds run one at a time. A
headless fan-out is exactly that shape, so `test/rapier-worlds.test.mjs` checks the
pair against a world run alone.
