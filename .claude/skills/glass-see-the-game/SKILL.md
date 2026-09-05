---
name: glass-see-the-game
description: Use when a question is about what is actually there in the running game world or on screen — and the answer must come from live engine data, not from reading source, type files, or a screenshot. Trigger it for: "what is that thing on screen / in my level", something missing or not appearing (is it hidden, blocked, off-screen, or absent?), something drawn wrong (grey box, flat colour, wrong shape), things overlapping, stacking, floating, or piling up at one spot, and checking positions, counts, sizes, or what blocks what after simulating steps. Also use when a debugging question would otherwise be answered by guessing from code or by eyeballing a picture — query the scene graph instead. Covers identify, describe, find, isolate, occlusion, diff, camera. Do not use for writing gameplay or rendering features, camera or effect authoring, renames, or for capturing/prompting on an image — that is the See Frames guide.
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
| does it actually look right — art, light, readability, A/B | `see.capture` | a real frame; needs a browser — see "A frame from a terminal" |
| render versus scene truth at the same instants | `see.moment` | one sheet; needs a browser |

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
  takes a path to the project directory — a bare name is one inside the
  checkout, `../x` or an absolute path is one anywhere. Never `.`.
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

## Limits

- `coverage` sums boxes before overlap — comparison, not screen share.
- `see.capture` answers from the tab the call names. With two pages attached,
  name one with `--client <id>`; an untargeted call is refused with the list.
- Queries compute from entity bounds — no lighting, material, animation or
  texture truth. Those need `capture`.
- HUD and screens are words already: `hud.read`, `screen.read`.
- Headless projection and the renderer derive the camera from the same view
  fields (engine/camera-project.js beside render.js `updateCamera` — change
  both together).

## Producing an actual image

Everything above answers from engine data. A picture costs about fifty times a
query and answers less, so it is the last resort — and when it is the right
one, the **See Frames** guide owns it: `sketch`, `capture`, `moment`, the size
a frame comes out at, getting a frame from a terminal with no tab of your own,
and how to prompt a vision model on the result.
