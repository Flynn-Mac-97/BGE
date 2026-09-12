## Decide three things out loud before you build

Write them at the top of the run. They are cheap now and expensive later.

1. **The camera** - what the player actually sees. It sets every dimension.
2. **The map archetype** - grid, free-form or modular-isometric. It sets how
   you place things, and whether rotations are free.
3. **The scale rule** - the player's height in metres, and the one clearance
   you will never go under.

Decide from the request, the reference and the named game. Ask once only if
genuinely ambiguous; after that nobody answers, so decide, say why, proceed.

### The camera decides the dimensions

| Camera | What it demands | Typical inflation over real life |
|---|---|---|
| first person | tight is fine; readability at eye height, 1.6-1.7 m | corridors ~1.5x, ceilings ~1.3x |
| third person | space behind and above the player for the camera arm | corridors ~2x, ceilings ~1.6x, doors wider |
| isometric / top-down | the ground plane is the read; near walls hide play | build to the fixed angle, cut near walls |
| side-scroller | one readable plane; depth is decoration | lanes flat, silhouette everything |
| fixed / cinematic | frames, not freedom | compose each shot as a still |

Real interiors read cramped in a game. Build doors, ceilings and corridors
larger than life on purpose, and write the number down. That is not a cheat,
it is the standard: a real 0.9 m door is a shoulder-scrape in first person and
unusable in third.

### The map archetype decides the placement

| Archetype | Reference games | Rule you adopt |
|---|---|---|
| **grid** | CS, Valorant, most competitive shooters | a grid unit and 90 degree rotations; every mass snaps |
| **free-form** | Skyrim, Elden Ring, open exploration | terrain first, elevation carries the read, rotations free |
| **modular-isometric** | Diablo, Hades, XCOM, city builders | ground is tiles of one footprint; heights in whole steps |

Read `references/map-archetypes.md` for the one you picked - it has the unit
choices, the rotation law, the sightline and clearance work, and the failure
each archetype invites. Do not read the other two.

A hub level is often two archetypes joined: a gridded interior inside a
free-form valley. Say where the seam is; do not average them.

## Human scale, and the clearances that make it playable

Proportion is in the reference. Absolute scale is not, so anchor it. Put a
1.8 m figure in the scene with the first mass (Liittschwager, Sony Santa
Monica) and never take it out. A size invented with nothing real beside it
drifts, and drifts further with everything stacked on it.

`references/human-scale.md` carries the level-design numbers - player capsule,
step, jump, cover heights, corridor and ceiling minimums, stair geometry,
slope limits, and the engine unit tables. Grep it for what you need; do not
read it whole. `references/real-world-sizes.md` has 239 sourced real-world
dimensions for the objects inside the space.

The three you should know without looking: **a doorway is about 1.2 x 2.4 m in
a game, crouch cover is about 1.1 m, full cover is about 2.0 m.** A mass
between those two heights is neither, and it will feel wrong to play without
anyone being able to say why.
