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

## What the probes exposed about cheap models

All three said the model looked good. Not one was critical, and not one named
anything it could not see. The rat is in fact a clean, readable model, so the
answers were not wrong — but nothing in the plugin's shape asked them to look
for a fault, and a reviewer that always approves is not a reviewer. Round b
went further and invented a material colour from a legend hex. This is the
known failure mode of small vision models and it is what the next round's
instruction work has to bite on: one question at a time, multiple choice
where possible, and never a field the model can fill with a plausible guess.
