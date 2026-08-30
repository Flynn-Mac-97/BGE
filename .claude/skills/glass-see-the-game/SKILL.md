---
name: glass-see-the-game
description: What the running game actually shows a player, and what each thing on screen is — answered from engine data, never a screenshot. Use when the code says one thing and the screen may say another, when something on screen is unidentified, or instead of reading type files to work out what an object is.
---
<!-- generated from plugins/builtin/see.agent.md at server start; edits are lost -->

# See

The gap this closes: your model of the game and what a player sees can
disagree, and the code does not say so. An unexpected shape on screen has no
name. Working out what an object is means opening its files. See answers from
the engine's own data — what is on screen, where, what it is, what is hidden,
whether it looks right — so a visual question costs a query, not a screenshot
and a guess.

Query first, pixels last. Route every question to the cheapest exact
authority — scene graph, then geometry, then renderer queries, then
pixels. Spend an image only on aesthetic judgement or an A/B choice.
Read down; stop at the first row that answers.

| question | use | costs |
|---|---|---|
| **what is THAT thing, at this spot on screen** | `see.identify '{"at":[50,50]}'` | nothing; ID buffer, falls back to boxes |
| what does a ray pass through, from a point or in a direction | `see.ray '{"at":[50,50]}'`, `'{"grid":[6,4]}'`, `'{"from":"you","direction":"down"}'` | nothing; works everywhere |
| what is on screen — counts, positions, sizes, coverage, regions, overlaps, between | `see.describe` | nothing; works everywhere |
| which entities match predicates — type, region, size, depth, cut, occlusion, distance | `see.find` | nothing; works everywhere |
| one entity in full — world box, screen box, cover, velocity, camera relation | `see.isolate` | nothing; may step the world once |
| how much of X is visible, and who blocks it | `see.occlusion` | nothing; ID buffer or rays |
| what changed over N steps — appeared, gone, moved, entered or left frame | `see.diff` | nothing; advances the world |
| why the frame looks wrong — eye inside a box, thing against the lens | `see.camera` | nothing; works everywhere |
| layout and composition, roughly | `see.sketch` | one small PNG; works everywhere |
| does it actually look right — art, light, readability, A/B | `see.capture` | a real frame; browser only |
| render versus scene truth at the same instants | `see.moment` | one sheet; browser only |

Never ask a vision model what a query answers. Vision models miscount
overlapping things and misjudge positions and distances; the query numbers
are exact, and every reply's `method` field names how it was computed.

These questions are never answered from pixels. Each one has a verb, and
the verb is exact where a look is at or near chance:

| never ask a picture | ask this |
|---|---|
| what is that thing on screen, what am I looking at | `see.identify` with the screen point — never guess it from a mark or a name |
| is anything floating, sunk, or built to the wrong surface | `see.describe` — read `heightGaps`, which names the band and the type above it |
| how many of X are there | `see.describe`, `see.find` |
| which is in front, what is blocking it | `see.occlusion` |
| how far apart, how big, how fast | `see.isolate`, `describe` with `between` |
| where on screen, which region, which third | `see.describe` — read `at`, never estimate it |
| is the frame too dark | the sidecar's `light` block |
| what does the HUD say | `hud.read`, `screen.read` |

Never phrase a question to a vision model as a negative — "which of these
is NOT a rat", "is anything missing". Models answer negation at chance and
say yes to almost any "is there an X" question. Ask the positive form and
compare it against the sidecar; absence is a query, not a look.

## Troubleshooting — route the symptom

- Screen looks wrong (blank, giant colour blocks, one flat colour):
  `see.camera` first. It answers whose box the eye is inside, what sits
  nearer than half a metre in front of the lens, and whether the followed
  entity is behind the camera or contains the eye.
- Thing should be visible but is not: `see.occlusion '{"of":"<id>"}'` —
  `visibleFraction` and `blockedBy` name the hider. Zero blockers? Run
  `see.isolate` on it: `hidden`, `onScreen: false`, or an off-frame world
  position is the answer.
- Something is on screen and you do not know what it is: take `see.capture`,
  read the mark number off the outline, look the mark up in the sidecar's
  `marks` to get the id, then `run description '{"of":"<id>"}'`. That answers
  what the author says it is, what a correct one looks like, and — the case
  that costs the most time — what a BROKEN one looks like. A big featureless
  block of flat colour is usually a `looksWrongWhen`, not a thing you have
  failed to recognise. The sidecar's `about` names every marked type;
  `undescribed` names the marked types nobody has written yet, so silence is
  never mistaken for "nothing to know". `appearance` is deliberately absent
  from the sidecar: a vision model handed a description of a thing will report
  seeing it, so ask the picture the positive question first and compare it
  against `description` yourself.
- Did it move, spawn, or die correctly: `see.diff '{"steps":30}'`.
- Inspect one thing: `see.isolate '{"subject":"<id>"}'` — the full dossier
  in one call.
- Only after these: an image, for judgement a number cannot carry.

## From a terminal

- With the editor open, plain `node bin/engine.mjs run see.<verb> '{...}'`
  drives it over the bridge. `--project` is only for `--headless` runs, and it
  takes the project DIRECTORY NAME (`kitten-survivors`), never `.`.
- `script '[...]'` is headless-only. Over the bridge, run one verb per call —
  the browser world keeps its state between calls.
- Add `"brief": true` in a busy scene: only marked entities are listed, with
  every count kept. A full meadow lists 700 props without it. It works on
  `capture` and `sketch` too, and it is the difference between a 16KB sidecar
  and a 9KB one on the meadow at 0:30.
- `simulate` answers compactly, like `snapshot`. Ask for the entity list with
  `{"entities": true}` when the list is the point.
- Simulating does not move the camera. The view stays where the editor left
  it, which in a headless run is the editor's own camera looking at an empty
  field — so a moment simulated but not aimed shows scenery and no creatures.
  Aim first: `see.view '{"aim":"you","back":3}'` frames the followed entity
  and every later query answers from there. The meadow's play camera is saved
  as the view `meadow-play`.

## Inspect one model, in one call

```sh
node bin/engine.mjs run see.capture '{"subject":"rat"}'
```

`subject` takes an entity id OR a type name. A live instance is used when one
exists; otherwise the type is previewed — spawned, framed alone against the
sky, captured, and removed, with `preview` in the reply. A name that is
neither answers early with the list of types. Never build a spawn-and-look
workflow by hand.

## Query commands

- `see.identify '{"at":[50,50]}'` — what is drawn at one screen point, as
  percent, x right and y down. Answers the entity's id, its type, and what its
  author says it is. The ID buffer answers where a renderer drew the frame;
  boxes answer otherwise, and `rendererWhy` names why the renderer did not. A
  blank buffer from a hidden tab is refused rather than read as empty sky.
  This is the verb for "what is that thing" — do not infer identity from a
  mark number, a type name, or the source.
- `see.ray '{"at":[50,50]}'` — every entity a ray through that screen point
  passes, nearest first, with distance and the author's description.
  `'{"grid":[6,4]}'` casts that over the frame and answers what is really in
  front of the camera, an order of magnitude smaller than a full entity dump.
  `'{"from":"you","direction":"down"}'` answers what is under a thing and how
  far — the support test. Rays hit collider and mesh BOXES, not drawn
  silhouettes, so a thin model can be missed; `limits` says so in every reply.
- `see.describe '{...}'` — the index every other answer builds on: camera,
  visible entities with screen positions (percent, x right, y down), sizes,
  depth, marks, off-screen counts, coverage, overlaps, occlusions, regions.
  Every one of those is a projection. Four fields are not, and they are where a
  structural fault shows: `verticalSpan` is each type's bottom and top face in
  world units; `heightGaps` names a height band nothing occupies and the type
  above it; `sizeOutliers` names an entity sized unlike its own kind;
  `stackedEntities` names entities at one position where only the front one is
  ever seen. The last three carry a `why` sentence and appear only when they
  have something to say. Read them before ranking anything yourself.
- `see.occlusion '{"of":"you"}'` — off frame answers `offscreen`, not zero.
  `visibleFraction` divides visible pixels by the PROJECTED BOX, so a shaped
  model reads below 1 with nothing blocking it — compare against its own
  uncrowded baseline, not against 1. Particles, decals and damage numbers are
  not entities, so the ID buffer cannot name them as blockers yet. ID buffer
  when a renderer answers; rays from the eye otherwise. Optional
  `rows`/`columns` set the sample grid (default 5x5).
- `see.isolate '{"subject":"rat-3"}'` — world and screen boxes, cut,
  region, visible fraction, blockers, velocity, and distance/facing to the
  followed entity. Velocity costs one fixed step; a stopped and unsimulated
  world, or a held clock, answers `velocity: null` with `velocityWhy` — a
  step under a hold would move nothing and read as a standstill.
- `see.find '{"type":"rat","region":"top-left"}'` — all entities matching
  every predicate: `type`, `idPrefix`, `region`, `sizeOver/Under`,
  `depthOver/Under`, `cutUnder`, `occludedOver/Under`, `within: [metres,
  "<id>"]`. Off-frame matches carry `offscreen: true`. Unknown predicate
  names throw.
- `see.diff '{"steps":30}'` — `appeared`, `gone`, `moved`, `enteredFrame`,
  `leftFrame`, counts before and after. Advances the world like simulate;
  `stop` restores the level. A held clock is refused before anything is
  stepped, naming the holder: nothing can move, and stillness would be a lie.
- `see.camera` — view, eye, `insideOf`, `nearerThanHalfAMetre` (perspective
  only — orthographic depth is always 0, and the reply says the test was
  skipped), `followed`.

## Image commands

- `see.sketch '{...}'` — flat-colour frame from computed facts: marked
  entities fill their screen hull in their type's colour, the rest are
  rectangles. Headless it writes `agent-runs/see/<name>.png` + `.json`; in
  the browser it also answers a `dataUrl`. An `alone` sketch whose subject is
  outside the frame is refused, never answered with a blank. A sketch says
  where things are and how the frame is arranged; it cannot say whether a
  shape reads as a rat — that needs `capture` with `subject`.
- `see.capture '{...}'` — the rendered canvas, marks drawn on top, same
  files. Browser only. A tab that is not drawing is refused with an error
  and a `hidden` flag, never returned as a blank frame. The sidecar's
  `light` block holds mean and 4x4-cell brightness, 0–100, measured over the
  pixels the draw put down; `over` names which pixels answered and
  `measuredFraction` how many, and a cell with nothing drawn reads `null`.
  Never ask vision if a frame is too dark.
- `see.moment '{"steps":[0,6,30]}'` — one sheet: the real render and its
  flat type layer at the same instants, stepped forward, every cell
  labelled. In the pixels but not the scene is a rendering artifact; in the
  scene but not the pixels is an invisible entity. Browser only; advances
  the world; `stop` restores. A held clock is refused before any step.
  `camera`, `view` and `subject` aim the LIVE camera for the sheet and put it
  back, so both lenses show one moment. Use a sheet to decide which single
  moment to capture, then ask your question of that one capture — a model
  reading several pictures at once is markedly worse than one reading one.

Image options: `camera` (view field overrides; top-down map shot: high y,
pitch -1.57), `shot` (a named angle with `subject`: `three-quarter` default,
`front`, `back`, `side-left`, `side-right`, `top`, `low` — measured from the
subject's facing), `view` (a saved camera by name — `see.view '{"save":"arena-south"}'`
keeps the current camera, saved in `<project>/views.json`, committed;
`see.view` alone lists; `'{"go":"arena-south"}'` aims the LIVE camera,
so the queries answer from that view too; `'{"aim":"you","back":3}'` aims it
at an entity or type, framed the way subject shots frame, pulled `back` times
out), `subject` (frame one entity; add `"alone": true` to hide the
rest — the studio: neutral light, no post, cropped to the drawn pixels, TRANSPARENT
background by default, and UNMARKED, with `silhouette` giving the subject's
traced outline in the crop's own coordinates; pass `background` with a colour
when a test needs a known backdrop), `between` (two ids — distance, touching, relative screen position,
facing), `ui: false` (hide player-facing overlays — damage numbers and
anything marked `userData.overlay` — when the question is the world, not the
HUD), `marks` (`"tags"` for the old numbered stamps, `false` for none), `name`
(writes `agent-runs/see/<name>.png`), `file` (the whole path, which must end
`.png` and stay under `agent-runs/`; the sidecar takes the same path with a
`.json` ending).

`see.capture` needs the dev server. Under `--headless` there is no renderer and
it says so.

Marks are HULLS: each marked entity is outlined in its TYPE's colour, drawn
on its own pixels — one colour per type, so a busy frame is a handful of
colours. The reply and sidecar both carry `palette` (type → hex), `marks`
(number → id) and each marked entry's `hull` (its screen outline as [x, y]
percent points). In a capture the hull traces the entity's drawn silhouette
from the ID buffer; in a sketch or bare describe it is the projected box.
The subject is white and wider — except in an `alone` studio frame, which is
unmarked on purpose. `palette` names OUTLINE colours and never a thing's own
material colour: a rat outlined in `#e06c72` is not a pink rat.

Which entities get marked: marks are dealt out by type, not by size. Every
type on screen takes its first mark before any type takes a second, rarest
first, so `palette` names every kind in frame. After that a type's turn comes
round in proportion to how much of it the camera holds — a sea of props is
sampled once or twice and the creatures take the rest. In a subject shot the
subject is always mark 1. Anything wider or taller than half the frame is a
backdrop and is never marked.

**Marks help you find a thing, and they make a frame score better than it
is.** An outline drawn on a picture measurably inflates a vision model's
judgement of it, and saying so in the prompt does not undo it. So a frame is
either for identification or for judgement, never both: keep the marks when
the question is which thing is which, and ask for a clean frame when the
question is whether the art is any good. An `alone` studio frame is already
unmarked and ships no `palette`, because judging the model is the only thing
it is for.

## A moment in time

Simulate to the moment, then look — one call, one world, deterministic:

```sh
node bin/engine.mjs --headless --project <p> script \
  '[["simulate",30],["run","see.diff",{"steps":60}],["run","see.sketch",{"name":"at-30s"}]]'
```

In the browser drive time with `simulate`, never by waiting. If time will
not advance, read `snapshot`; `paused` names who holds the clock.

## Reading a frame with a vision model

- Send the PNG and its `.json` sidecar together. The sidecar is ground truth
  for the fields it lists and silent on everything else. Where the sidecar
  and the picture disagree about something the sidecar measures, the sidecar
  wins; where they disagree about anything else, say so rather than resolving
  it. The sidecar carries measurements and never a verdict — a model will
  adopt a judgement it is handed instead of forming one.
- Refer to entities by hull colour and mark number together — `palette` maps
  colour to type, `marks` maps mark numbers to ids, and each marked entry's
  `at` names where it sits. This is a house convention that works, not a law
  of vision models: cross-check the colour against the number and the number
  against `at`. Never bind by floating text; the game draws its own numbers.
- One question per read, multiple-choice where possible. "Does the white
  outlined thing read as a rat or a box, A or B" beats "describe the scene".
  Ask for the choice and one short sentence of reason — and treat the reason
  as a hint, never a fact. A model's verdict is far better than its account
  of where the problem is, and any "where" claim has to be checked against
  `see.describe` before it is acted on.
- Comparing two frames is a forced choice, never a score out of ten. Ask
  which is better, then ask again with the two swapped; a flip means no
  difference. If a scale is needed at all, use words — excellent, good, fair,
  poor, bad.
- A subject under ~5% of the frame: capture it with `subject`. Below that
  size, answers fall away sharply, and cropping to the subject wins back most
  of what was lost.

### When a small or cheap model is doing the looking

It will not degrade gently. On this exact task — judging one rendered game
frame — the small tier of a model family scores near chance where the large
tier is reliable, and its failure is a stuck answer rather than a wrong one.
A question whose answer is stuck returns no information at all.

- Spend the image on ONE subject, framed alone. A crowded frame is where the
  cheap tier collapses.
- Give it a forced binary choice. Never open description, never "find
  anything wrong" — it will say everything is fine, every time.
- Do not rely on it reading marks. Put the identifying fact in the question
  and in the crop, not in the overlay.
- Ask twice with the options swapped, and treat disagreement as no answer.
- Never route counting, depth or distance to it. For a small model the query
  path is not the cheaper path, it is the only correct one.

## Limits

- `coverage` sums boxes before overlap — comparison, not screen share.
- `see.capture` answers from whichever attached tab replies first — keep
  one editor tab open; frame size is that tab's canvas size.
- Queries compute from entity bounds — no lighting, material, animation or
  texture truth. Those need `capture`.
- HUD and screens are words already: `hud.read`, `screen.read`.
- Headless projection and the renderer derive the camera from the same view
  fields (engine/camera-project.js beside render.js `updateCamera` — change
  both together).
