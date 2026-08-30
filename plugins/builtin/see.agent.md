# See

Query first, pixels last. Route every question to the cheapest exact
authority — scene graph, then geometry, then renderer queries, then
pixels. Spend an image only on aesthetic judgement or an A/B choice.
Read down; stop at the first row that answers.

| question | use | costs |
|---|---|---|
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

## Troubleshooting — route the symptom

- Screen looks wrong (blank, giant colour blocks, one flat colour):
  `see.camera` first. It answers whose box the eye is inside, what sits
  nearer than half a metre in front of the lens, and whether the followed
  entity is behind the camera or contains the eye.
- Thing should be visible but is not: `see.occlusion '{"of":"<id>"}'` —
  `visibleFraction` and `blockedBy` name the hider. Zero blockers? Run
  `see.isolate` on it: `hidden`, `onScreen: false`, or an off-frame world
  position is the answer.
- What is drawn at a spot / what is this pixel: the renderer's ID buffer,
  through `see.occlusion` — `method: "id-buffer"` means real rendered
  pixels answered. Never a vision read.
- Did it move, spawn, or die correctly: `see.diff '{"steps":30}'`.
- Inspect one thing: `see.isolate '{"subject":"<id>"}'` — the full dossier
  in one call.
- Only after these: an image, for judgement a number cannot carry.

## Query commands

- `see.describe '{...}'` — the index every other answer builds on: camera,
  visible entities with screen positions (percent, x right, y down), sizes,
  depth, marks, off-screen counts, coverage, overlaps, occlusions, regions.
- `see.occlusion '{"of":"you"}'` — off frame answers `offscreen`, not zero.
  `visibleFraction` divides visible pixels by the PROJECTED BOX, so a shaped
  model reads below 1 with nothing blocking it — compare against its own
  uncrowded baseline, not against 1. Particles, decals and damage numbers are
  not entities, so the ID buffer cannot name them as blockers yet. — `visibleFraction` 0–1 and `blockedBy`.
  ID buffer when a renderer answers; rays from the eye otherwise. Optional
  `rows`/`columns` set the sample grid (default 5x5).
- `see.isolate '{"subject":"rat-3"}'` — world and screen boxes, cut,
  region, visible fraction, blockers, velocity, and distance/facing to the
  followed entity. Velocity costs one fixed step; a stopped, unsimulated
  world answers `velocity: null` with `velocityWhy` instead of moving the
  level.
- `see.find '{"type":"rat","region":"top-left"}'` — all entities matching
  every predicate: `type`, `idPrefix`, `region`, `sizeOver/Under`,
  `depthOver/Under`, `cutUnder`, `occludedOver/Under`, `within: [metres,
  "<id>"]`. Off-frame matches carry `offscreen: true`. Unknown predicate
  names throw.
- `see.diff '{"steps":30}'` — `appeared`, `gone`, `moved`, `enteredFrame`,
  `leftFrame`, counts before and after. Advances the world like simulate;
  `stop` restores the level.
- `see.camera` — view, eye, `insideOf`, `nearerThanHalfAMetre` (perspective
  only — orthographic depth is always 0, and the reply says the test was
  skipped), `followed`.

## Image commands

- `see.sketch '{...}'` — flat-colour frame from computed facts, marks
  stamped. Headless it writes `agent-runs/see/<name>.png` + `.json`; in the
  browser it also answers a `dataUrl`.
- `see.capture '{...}'` — the rendered canvas, marks drawn on top, same
  files. Browser only. A tab that is not drawing is refused with an error
  and a `hidden` flag, never returned as a blank frame. The sidecar's
  `light` block holds mean and 4x4-cell brightness, 0–100 — never ask
  vision if a frame is too dark.
- `see.moment '{"steps":[0,6,30]}'` — one sheet: the real render and its
  flat type layer at the same instants, stepped forward, every cell
  labelled. In the pixels but not the scene is a rendering artifact; in the
  scene but not the pixels is an invisible entity. Browser only; advances
  the world; `stop` restores.

Image options: `camera` (view field overrides; top-down map shot: high y,
pitch -1.57), `shot` (a named angle with `subject`: `three-quarter` default,
`front`, `back`, `side-left`, `side-right`, `top`, `low` — measured from the
subject's facing), `view` (a saved camera by name — `see.view '{"save":"arena-south"}'`
keeps the current camera, saved in `<project>/views.json`, committed;
`see.view` alone lists), `subject` (frame one entity; add `"alone": true` to hide the
rest), `between` (two ids — distance, touching, relative screen position,
facing), `marks: false`, `name`.

## A moment in time

Simulate to the moment, then look — one call, one world, deterministic:

```sh
node bin/engine.mjs --headless --project <p> script \
  '[["simulate",30],["run","see.diff",{"steps":60}],["run","see.sketch",{"name":"at-30s"}]]'
```

In the browser drive time with `simulate`, never by waiting. If time will
not advance, read `snapshot`; `paused` names who holds the clock.

## Reading a frame with a vision model

- Send the PNG and its `.json` sidecar together; the sidecar is ground
  truth, pixels answer only what it cannot say.
- Refer to entities by mark number; `marks` in the reply maps them to ids.
- One question per read, multiple-choice where possible. "Does mark 3 read
  as a rat or a box, A or B" beats "describe the scene".
- A subject under ~5% of the frame: capture it with `subject`.

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
