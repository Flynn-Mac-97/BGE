# Query commands

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
