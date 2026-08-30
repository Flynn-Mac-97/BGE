# See probe round 1 — does See beat the plain route?

Written 2026-08-30. The answer key was measured and committed to this file
BEFORE any agent was asked, which is the point: the finish-line loop scored
itself on questions whose answers were fields in its own output.

Scene: `kitten-survivors`, level `meadow`, dev server on port 5191, world
restored and held still at t = 30. 892 entities.

## Arms

Six agents on the cheapest tier, one probe each.

- **See arm** — told the plugin exists and where its guide is.
- **Control arm** — told `help` exists, and forbidden from any `see.` command.

The control is not clean on knowledge: a subagent may still see the
`see-the-game` skill in its harness listing, and forbidding the route names
it. It is clean on the route, which is what the number needs to be about — is
See faster or truer than the plain route, not does an agent know it exists.

## Answer key, measured first

**P1 — what is floating in the scene?**

Everything except the floor. `floor` is a `ground` slab placed at y = -6.5
with a 1-high box, so its top face is at y = -6.0. Every other entity is
authored at y = 0: the kitten, 116 rats, 23 gems and 743 props. The whole
meadow floats six metres above the surface it is supposed to rest on.
`kitten-survivors/types/ground.js` states the rule the placement breaks — a
slab is placed at y = -height/2, which is -0.5 here.

- Correct: names the six-metre gap, or the floor being six too low, or
  everything sitting six above the floor.
- Wrong: names individual props as floating decoration; says nothing floats.

**P2 — how many enemies can the player actually see right now?**

60. Sixty rats are inside the frame, of 116 in the level. No other enemy type
has a live entity — boar, crow, hound and wasp are all zero.

- Correct: 60.
- Wrong-but-diagnostic: 116. That is the level, not the frame, and it is the
  failure the plain route is expected to make.

**P3 — is anything hidden behind something else?**

Effectively nothing. No entity reports an `occluded` value. Two rats are
clipped by the edge of the frame — `rat-114` at 45.7% cut and `rat-48` at
70.6% — and cut by the frame is not hidden behind an object.

- Correct: nothing is behind anything; optionally names the two clipped rats.
- Wrong: invents an occluder; treats the frame edge as an object.

## Scored on

Truth, tool calls, and whether a wrong answer was given confidently. A
confident wrong answer scores below "I cannot tell", because an agent that
knows it does not know keeps looking.

## Result

| Probe | Arm | Answer | Verdict | Calls | Tokens |
|---|---|---|---|---|---|
| P1 floating | See | projectiles and yarn float | wrong, confident | 1 | 32.4k |
| P1 floating | control | the xp gems float | wrong, confident | 14 | 56.7k |
| P2 count | See | 60 | correct | 2 | 37.7k |
| P2 count | control | I cannot tell | honest miss | 11 | 51.1k |
| P3 hidden | See | nothing is hidden | correct | 2 | 32.7k |
| P3 hidden | control | 21 hidden entities | wrong, confident | 30 | 59.8k |

See: 2 of 3 true, 5 calls, 102.8k. Control: 0 of 3 true, 55 calls, 167.5k.

A fresh agent costs 20.4k before it does anything, so the work itself is 41.6k
for See against 106.3k for the control. See answered more of the questions for
39% of the tokens and a ninth of the calls. That is the number this plugin did
not have.

## What the round found

**See has no world position, and does not say so.** `see.describe` returns a
screen `at` and a `depth`, and nothing in world space. P1 is a world-space
question, so the See agent had no data for it — and answered anyway, reading
`depth` as height. The field name invites that reading. The plugin's whole
claim is that it stops confident wrong answers about the screen, and here it
produced one in a single call.

Backlog item 1, the ray verb, is the fix for asking a question from the view.
Carrying world y in `describe` is the smaller fix for reading one.

**Neither arm refuses when it should.** Three of the four wrong answers were
stated flatly. The control invented a renderer to support its answer —
"orthographic 2D rendering with painter's algorithm, render order = Z * 1000 +
index" — for a scene `see.describe` reports as `perspective`. A reply that
names what it cannot answer would have stopped all three.

**Where See won, it won on frame scope.** P2 is the plain route's known
failure: the level holds 116 rats, the frame holds 60, and a snapshot cannot
tell them apart. The control found 116, saw it was not an answer, and stopped.
The See agent answered 60 and volunteered that 56 were off-screen.

## Round 2

Re-run P1 on both arms after `describe` carries world position, and check
whether the See arm flips from confidently wrong to correct. Add probes whose
true answer is "nothing is wrong" on a scene without a standing defect.
