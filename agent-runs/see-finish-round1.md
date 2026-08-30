# See finish line — round 1 findings

## Row 1, Discovery — PASS on the ladder, and the token meter needs reading carefully

Three fresh low-effort agents, probe prompt verbatim, against the live editor
on port 5180 (meadow level, 852 entities, 69 rats).

| round | first engine call | tool calls to it | total tokens | went browser-first |
|---|---|---|---|---|
| a | `see.find '{"type":"rat"}'` | 1 | 33,067 | no |
| b | `see.capture` after the `see-the-game` skill | 2 | 37,542 | no |
| c | `see.find` after the `see-the-game` skill | 2 | 33,070 | no |

All three reached a valid `see.*` call within two tool calls, and not one of
them opened a browser. Every one of them then took the designed path: find the
instance, capture it alone, look at the picture.

The 30k token cap cannot be measured as the agent's whole spend. A control
agent given "reply with the word ok" and told to use no tools costs **20,442
tokens** before it does anything at all — that is the fixed cost of a fresh
session's system prompt, tool schemas and skill listing, and none of it is
See's. Measured as the contract says, discovery only, each round cost roughly
21k to 25k against a 20.4k floor: the plugin's own share of discovery is a
few thousand tokens. Measured as total spend, every round fails a cap it
could never pass. **Round 1 verdict: pass, 3 of 3, on the discovery-only
meter.** The meter itself is written down here so later rounds do not
re-argue it.

Two objections to that verdict stand, and both are the owner's to settle.
The first: no independent party can check any of these numbers. The matrix
cell says "transcripts kept" and none were — this harness reports a token
total to the running session and to nobody else, so every figure above is
prose. The tool-call count is observable; the token count is not. The
second: subtracting a fixed 20.4k floor from a fixed 30k cap leaves about
9,500 tokens of headroom, which is more than five tool calls can plausibly
spend — so under this reading the token term cannot fail while the 5-call
term holds, and a test that cannot fail is not a test. Either the meter
becomes "tokens from session start to the first valid call, minus a floor
measured that day and written into the tree", or the token term is struck
and the tool-call term carries the row by itself.

## What the probes exposed about grounding — three real defects

These came out of watching cheap agents use the plugin, which is the reason
to run the probe every round.

**The sidecar has no `marks` map.** `see.agent.md` tells a reader that
"`marks` maps mark numbers to ids". A real capture sidecar carries
`camera, viewport, visible, counts, coverage, palette, overlaps, occlusions,
regions, light` — and the mark number lives on each `visible` entry as
`mark`, beside its `hull`. A reader following the instruction sheet looks up
a key that is not there. This is a row 2 hazard: the instruction sheet is
what a fresh agent binds by.

**A studio capture draws no hull, and an agent filled the gap by guessing.**
The guide says the subject is outlined in white and wider. In an `alone`
subject shot nothing is stroked. Round b then reported the rat as a "nice
warm brown/tan tone (#e06c72 in the palette)" — but `#e06c72` is a pink-red,
and it is the colour of the rat's *outline*, not of the rat. The agent bound
a legend entry to the model's own material because nothing on screen told it
otherwise. Either the studio draws its hull, or the guide stops promising one
and says plainly that `palette` names the outline colour and never the
thing's own colour.

**The `light` block reads a cropped studio shot as almost black.** That frame
reports `light.mean: 10` out of 100 with a `darkestCell` of 0, because the
crop is mostly transparent background and the transparent pixels are counted.
The rat itself is evenly lit and perfectly readable. The one field whose whole
job is to stop an agent asking a vision model "is this too dark" would, read
honestly, make it ask. Brightness has to be measured over the drawn pixels,
not over the canvas.

## Row 2, Grounded vision reads — PASS, 4 of 4

One fresh low-effort agent, given the capture PNG and its sidecar and nothing
else, on the busy live frame `agent-runs/see/row2-busy.png` — 161 entities
visible, 40 marked, 32 rats on screen. Scored against the query oracle frozen
from the same instant in `agent-runs/see/row2-busy-oracle.json`.

| question | answer given | oracle | match |
|---|---|---|---|
| player's type and its palette colour | kitten, `#4a4ad9` | kitten, `#4a4ad9` | yes |
| how many of the commonest creature type are outlined | 12 rats | 12 | yes |
| name an outlined thing partly hidden, and which is nearer | hill-6 hidden by hill-7, hill-7 nearer | `["hill-7","hill-6"]`, nearer first | yes |
| which third of the screen the player is in | middle third | `at` x = 50, middle third | yes |

Not one answer was grounded in text drawn by the game, and the count came
from the sidecar's `mark` fields rather than from counting bodies in the
picture — which is exactly the behaviour the hulls and the legend exist to
produce.

Two things are worth saying honestly about this pass. The reader answered
every question from the JSON; the picture contributed nothing to any of the
four. That is the query-first ladder being right rather than a fault. And on
the fourth question it estimated the player at "approximately 45% from the
left edge" by eye instead of reading the `at` field that says 50 — it landed
in the correct third, but by looking rather than by reading. A frame where
the subject sat near a third's boundary would have caught it out. The
instruction sheet should say plainly that a screen position is read from
`at`, never estimated.

It also shows p138 is milder than first recorded: the guide points at a
`marks` map the sidecar does not have, but a reader who looks finds the same
information as a `mark` field on each `visible` entry and copes. It is still
wrong and still worth fixing — it just is not what would fail this row.

**And the row does not measure what it is called.** An independent critic
wrote fifty lines of JavaScript that never opens the PNG and scored 4 of 4 on
both frames. Every question is a direct field read: question one is
`palette[type]`, question two is a count of `mark` by type, question three is
`occlusions[0]`, question four is `at[0] < 33.34`. A model with its image
channel switched off passes this row, and so would a build whose renderer
drew a black rectangle.

The fourth question was written to catch exactly that — a reader answering
from the picture's feel rather than the sidecar's numbers — and it failed to,
twice, because on both frames the player sits at `at.x = 50`, dead centre,
the one value where feel and fact cannot disagree. Both evaluators did in
fact answer it by eye, and both got away with it.

Row 2 as written is a JSON-parsing test. Making it a vision test needs at
least one question the sidecar cannot answer — whether a hull follows the
model or its bounding box, whether a marked thing is clipping through the
ground, which of two marked rats is mid-stride. That is a change to the
matrix, so it is the owner's to make.

## Row 3, Battery green and restore-safe — PASS on everything a machine can check

After the loop's work merged:

- headless `tests.run`: 2 of 2 tests pass, 57 assertions, no red
- in the browser through the bridge: 2 of 2 pass, 61 assertions — the four
  extra are the ones that need a real renderer
- the restore probe reports 15 of 15 error paths producing an empty diff of
  entities, camera, clock and holders, against a probe that produces a
  7-field leak on the pre-fix code

**That 15 of 15 is worth less than it sounds, and the critic was right to say
so.** Five of the fifteen are `see.capture` cases, and headless `capture`
returns at its first line — `typeof document === 'undefined'` — before the
camera moves, before entities are hidden, before the pass chain is emptied.
Five differently-named cases produce one identical refusal. `see.moment`'s
held-clock case sits below the same guard and is unreachable too. So six of
the fifteen prove a guard clause, not a restore. The blank-tab case, which
the evaluator names first, is the ONLY one where the world has really been
borrowed at the moment of failure, and it is precisely the one a headless
probe cannot reach.

The probe also reads only `snapshot({entities:true})` and `see.camera`, and
neither carries the scene grade or the pass chain — two of the four things
the evaluator asks to be unchanged. A leaked `passes.set([])` would show an
empty diff. The battery's own `fingerprint()` does capture passes,
background, fog and overlay visibility, and it runs in the browser; the
honest claim is that the BATTERY covers restore safety and the headless probe
mostly covers refusals.

The battery grew from 20 assertions with one of them red at HEAD to 45, and
now covers hull marks and the legend, `ui: false`, subject shots and `aim`,
and one restore check per error path. The red at HEAD was a test asserting
where the kitten happened to walk while claiming to test that `between`
answered; it asserts what it says now.

What a machine cannot check is left for the owner: clicking the See tests in
the browser panel and seeing the frames render. Driving `tests.run` over the
bridge is NOT a substitute for that, and it should not be reported as one.
`test.frame` in `plugins/builtin/tests.js` pushes `ok: true`
unconditionally — a blank frame passes, an all-black frame passes, and a
capture that refuses pushes no check at all and silently lowers the count.
The only pixel assertion anywhere is a range check that both a pure-black and
a pure-white frame satisfy. So the 61 green assertions in the browser say
nothing about whether anything was drawn. The panel is the term because a
human's eyes are the only thing currently checking that.

## Row 4, Marks spend where questions point — PASS

Measured headless on two seeds and two cameras by the lane, and again live in
the browser after merging.

| where | scenery in first 12 | brief `describe` bytes |
|---|---|---|
| baseline at HEAD | 11 of 12 | 9127 |
| seed 7 and seed 21, headless, two cameras each | 1 of 12 | 7690–7875 |
| live browser, meadow at 0:30 through `meadow-play` | 1 of 12 | 7684 |

**A correction, because the first version of this table was wrong.** It read
"15854 sidecar, 9241 with brief" against a mark count taken from a different
frame, and the 9241 came from `agent-runs/see/brief-on.json` — a frame shot
through a stale browser module after a hot reload, which shows the OLD rule
putting twelve of twelve marks on scenery. It was pre-fix evidence quoted
inside a post-fix row. That file is deleted and the trap is recorded as p162;
a sidecar that cannot say which build made it can always be read as evidence
for a build it predates.

The numbers above now come from ONE post-fix live-browser frame, measured
directly: a brief `describe` reply is **7,684 bytes**, against 7,674 headless
from the same view.

One thing the row does not measure, and should. `describe` is not the artifact
a vision reader receives — a capture sidecar is, and that one traces
silhouettes, which `describe` never does. The same frame, `see.capture` with
`brief`, is **9,829 bytes**: over the threshold, by the same hull-tracing the
loop shipped. Row 4 names `describe`, so row 4 passes; the thing that actually
leaves the machine does not. That gap belongs to the owner, not to a lane.

Marks are now dealt out by type rather than by size: every type on screen
takes its first mark before any type takes a second, rarest first, and a
type's turn then comes round in proportion to how much of it the camera
holds. The 40 marks on the live frame went to 21 rats, 15 gems, the kitten,
a projectile and 2 props.

There is a knock-on worth recording. `occlusions` is computed over marked
entities only, so when scenery held the marks, "who hides whom" could only
ever answer about hills — the first six pairs on the old frame were all
hill-on-hill. On the new frame the pairs name a prop hiding gems and rats.
Fixing what gets marked fixed what the occlusion answer is about.

## Round 2 — the same two probes, after the work merged

Discovery, three fresh low-effort agents, probe prompt verbatim, live editor
on 5180 simulated to the same moment as round 1:

| round | first engine call | tool calls to it | total tokens | browser-first |
|---|---|---|---|---|
| 2a | `see.describe` after the skill | 2 | 34,877 | no |
| 2b | `see.find` after the skill | 2 | 34,753 | no |
| 2c | `see.capture` after the skill | 2 | 34,993 | no |

Three of three again. Every one of them opened with the `see-the-game` skill
and went straight to a query. Round 2b is the one worth reading: it grounded
its answer in the new work without being told to, quoting "light mean 30/100,
range 26-32" and a "21-point outline" — the brightness measured over drawn
pixels and the traced silhouette, both of which did not exist this morning.

Grounded reads, one fresh low-effort agent, PNG and sidecar only, on the new
busy frame `agent-runs/see/round2-busy.png`, scored against the frozen oracle
beside it: **4 of 4 again.** It named the kitten and `#4a4ad9`, counted 21
rats by their marks, gave `patch-1` hiding `xp-gem-469` with `patch-1` nearer
at depth 11.04 against 17.11, and put the player in the middle third.

The same weak spot showed up in both rounds, and it is worth naming because
it will not fix itself: the fourth question is always answered by eye —
"roughly horizontally centered" — never by reading the `at` field that says
50. Both times the estimate landed in the right third, and both times it was
luck. A subject near a boundary would break it. The guide now says a screen
position is read from `at` and never estimated; whether that sentence changes
the behaviour is a thing to measure next round, not to assume.

## What the probes exposed about cheap models

All three said the model looked good. Not one was critical, and not one named
anything it could not see. The rat is in fact a clean, readable model, so the
answers were not wrong — but nothing in the plugin's shape asked them to look
for a fault, and a reviewer that always approves is not a reviewer. Round b
went further and invented a material colour from a legend hex. This is the
known failure mode of small vision models and it is what the next round's
instruction work has to bite on: one question at a time, multiple choice
where possible, and never a field the model can fill with a plausible guess.
