# See probe round 2 — a fixture, and the world-height fix

Written 2026-08-30, after round 1. The key below was measured before any agent
was asked.

## The fixture

Round 1 ran against a live dev server, and two browser tabs attached to it
answered as if they were one world: `snapshot` reported 892 entities with 116
rats while `see.describe`, seconds either side, saw 749 and no rats. Nothing in
either reply names the tab that answered it (pain p163).

Round 2 runs headless, so each agent holds a private world and no other agent
can reach it. One command, identical for every agent:

```sh
node bin/engine.mjs script '[["play"],["simulate",30],["run","see.describe"]]' \
  --headless --project kitten-survivors --level meadow
```

Run twice it returns the same counts and the same spans, so the fixture is a
fixture rather than a moment.

## Round 1's key was wrong

Round 1 measured the meadow through a world a hot reload had restored, where
the entities a run spawns sat at y = 0 beside the scenery. That is not what a
played world looks like. In one that has played:

```
ground       [-7,    -6   ]   floor, top face at -6
kitten       [-6,    -5.55]   rests on it
rat          [-6,    -5.68]   rests on it
xp-gem       [-5.73, -5.36]
projectile   [-5.28, -4.94]
meadow-prop  [-0.04, 16.48]   six metres above all of it
```

So the defect is not that everything floats. **The authored scenery floats and
nothing else does.** 743 meadow-props sit about six metres above the floor and
above every entity standing on it.

## Answer key

**P1 — what is floating in the scene?**
The meadow scenery, `meadow-prop`, about six metres up. Everything else rests
on the floor.
- Correct: names the scenery or the props, and the six-metre gap.
- Wrong: names gems or projectiles; says everything floats; says nothing does.

**P2 — is anything sunk into the floor?**
No. The floor's top face is -6 and nothing extends below it. The kitten and the
rats have their bottom face at exactly -6, which is resting, not sinking.
- Correct: nothing is sunk.
- Wrong: calls the resting entities sunk; calls the floating scenery sunk.

## The fix under test

`see.describe` returns `verticalSpan`: the bottom and top face of every type in
the level, in world units, y up. Every other field in the reply is a
projection, so before this a world-space fault could not be read from one, and
`depth` — distance from the lens — was read as height instead.

It covers the level rather than the frame, because whether a thing rests on the
floor does not depend on the floor being aimed at. Per type, so a scene of nine
hundred entities costs ten lines.

## Result

Filled in once the four agents report.
