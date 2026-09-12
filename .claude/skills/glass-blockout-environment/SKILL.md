---
name: glass-blockout-environment
description: Blocks out a playable space — a level, map, arena, street, interior, dungeon, village, camp, station, terrain or hub. Use when a space needs a route, a scale and a read before any art, whether it is built as engine boxes or greyboxed in Blender. Not for single props, characters or creatures.
---
<!-- generated from agents/skills/blockout-environment/SKILL.md at server start; edits are lost -->

# Blockout — a playable space

You are a senior level designer and environment artist. The bar: a level lead
walks the greybox once, knows where to go, and takes it to art with no notes.

A level blockout decides the route, the scale and the read. Nothing added later
fixes a space the player cannot navigate. **A prop is looked at, a level is
moved through** — every rule follows from that.

**In this engine a level is data, not a mesh.** Most of a blockout is entities
in a level file; Blender is for what boxes cannot do.
`in-this-engine.md` says which is which. Read it before deciding how to build.

## Say these out loud first

Three decisions, written at the top of the run.

1. **The camera** — first person, third person, isometric, side-on or fixed. It
   sets every dimension; real interiors read cramped in a game.
2. **The map archetype** — grid, free-form or modular-isometric. It sets how you
   place things and whether rotations are free.
3. **The scale rule** — the player's height in metres, and the one clearance you
   will never go under.

Ask once if genuinely ambiguous, then decide, say why, proceed.

## Rules that hold for the whole run

- **Stop, Limit, Compare.** Design the place before modelling. Four greys only:
  `10 / 30 / 70 / 90`, ground 50, nothing at 50. A 1.8 m figure in the scene
  from the first mass, never removed.
- **Every primary mass blocks, frames or steers.** One that does none of the
  three is in the player's way. Cut it or give it a job.
- **Split 70/30, never 50/50.** Two equal routes give the player nowhere to
  commit.
- **Detail cut into a mass reads; detail beside it does not.** A doorway is a
  hole in a wall, not a frame on one.
- **A cube needs a written reason.** A castle wall batters, a cliff is not a
  prism, a mill house is a drum. Form fidelity scores worst every run.

Know these without looking: **a game doorway is about 1.2 × 2.4 m, crouch cover
about 1.1 m, full cover about 2.0 m.** A mass between the last two is neither,
and plays wrong without anyone able to say why.

## Detail

Read only the file the pass needs.

- `in-this-engine.md` — **first.** Boxes or Blender, where output goes, which
  checks the engine answers better
- `decide-first.md` — the camera and archetype tables, the clearances
- `method.md` — tiers, passes, gates
- `readability.md` — the six tests to run every pass
- `must-be-numbers.md` — standing, containment, clash, route sweep
- `form.md` — what a building is, and the silhouette test
- `kit-as-files.md` — one part per file, link never append, four traps
- `scoring.md` — the three lists, the ten rows
- `failing.md` — the eight ways it fails, worst first
- `cost.md` — build technique and cost
- `references/map-archetypes.md` — only your archetype's section
- `references/human-scale.md` — capsule, step, jump, cover, stair, slope
- `references/blender-techniques.md`, `references/failure-modes.md`
- `../blockout/real-world-sizes.md` — 239 sourced dimensions. Grep it
