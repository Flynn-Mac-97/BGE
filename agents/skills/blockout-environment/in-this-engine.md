# Blocking out a space for this engine

The skill is written for Blender, a kit of `.blend` files and a placement
script. In this engine most of that job is already the level format's job. This
says which half goes where.

## A level here is data, not a mesh

A level is `<project>/levels/<name>.json`: entities with `at`, `rotation` and a
`mesh` of `box`, `quad`, `sphere`, `parts` or `model`. The editor drags them,
the 3D gizmo turns them, `history.undo` steps back, and an agent rewrites the
file whole. That is the same loop the skill asks for — *build it so a wall can
move 3 m in one edit* — and the engine already has it.

So the split is:

| the mass is | build it as |
|---|---|
| a wall, floor, slab, platform, ramp, the route's edges | entities in the level file. `box`, `quad`, or `parts` for a composite |
| a kit piece placed fifty times — wall, corner, door, window, ramp, stair | a **type** in `<project>/types/`, placed as entities. The type is the kit file |
| a field of the same thing — trees, rubble, crates | the **Scatter** plugin. `scatter.preview` grows it to look at, `scatter.expand` writes it into the level |
| terrain, landform, a cliff, a crowned road, a swept deck | Blender, exported as GLB |
| the hero building, a landmark with a real silhouette | Blender, exported as GLB |

**Do not export a whole level as one GLB.** It arrives as a single mesh nobody
can move, with no collision the engine understands and no way to shift one wall.
The skill's kit-and-placement structure maps onto types-and-entities; keep it
there. Read `kit-as-files.md` for the reasoning and apply it to types.

Blender needs its GUI open and **BlenderMCP → Connect** pressed. If it is not
connected, say so and ask, then build what boxes can build and name what is
missing.

## Where the output goes

| what | where |
|---|---|
| the level | `<project>/levels/<name>.json` |
| types and kit pieces | `<project>/types/`, made with `run new.file` |
| Blender scripts, gate renders, `iterations.md`, `friction-log.md` | `agent-runs/<date>-<subject>/` |
| exported terrain and landmark meshes | `<project>/assets/*.glb` |

`agent-runs/` is swept after a week and nothing in it is committed. Never write
a build script at the checkout root.

## Handing it to the engine

- **Metres, and an entity's `y` is its centre.** A 2 m wall standing on the
  floor sits at `y: 1`. The skill's clearances carry over unchanged.
- **A model that stands on the floor says so:** `"anchor": "feet"`. Without it
  the mesh floats by half its own height.
- **`rotation` is degrees.** A bare number is yaw; `[x, y, z]` is pitch, yaw and
  roll. On a grid map, keep it to multiples of 90 and say so.
- **`segments` subdivides**, and only a material that moves vertices needs it.
- **Write the place down.** `run description '{"type":"<t>"}'` is what the author
  said a thing is meant to be. A level whose masses have no descriptions is a
  level the next agent judges against nothing.

## Checks the engine answers better

The skill's six readability tests were written for Blender renders. Four of them
are engine commands here, and the engine's versions measure the frame the player
gets rather than a studio render.

- **The walk, and the gameplay frame.** `run see.view '{"save":"<name>"}'` keeps
  a camera by name, `see.view '{"go":"<name>"}'` returns to it, and
  `run see.capture` takes the frame. Save the entry, the route points and one
  camera per play area, then every pass re-renders exactly the same frames —
  which is what makes two passes comparable.
- **The silhouette test, without Blender.** `see.capture` writes a sidecar in
  which each marked entity's `hull` is the **drawn** silhouette, traced from an
  ID pass. Hull area over its own bounding-rectangle area is the skill's form
  fidelity number, at the shipping camera. A hull is convex, so a C-shape reads
  as filled: a low score proves the outline is broken up, and 1.000 proves a box.
- **Depth layers and framing.** `run see.describe` answers in facts — what is on
  screen, where, how much of the frame each thing takes, what overlaps what,
  what occludes what, and which region of the frame each thing sits in. No
  vision read, no pixels. Read it before spending a capture.
- **Nothing floats, nothing interpenetrates.** `run physics3d.raycast` casts a
  ray and says what it hit, and `run see.ray` answers what sits at a screen
  point or in a direction from an entity. Use them for the standing and
  containment checks rather than trusting a render, and prove the check bites by
  moving one mass 1 m into the path.
- **Is the route clear.** The player capsule sweep is the same test; do it with
  the physics plugin against the real level, not against a Blender copy.
- **Can it be afforded.** `run profile.frames`, twice — the first run measures
  the scene settling. The engine's ceiling is per-entity work on the thread, not
  the shader, so a blockout's cost is its entity count. `plugins/builtin/profiler.agent.md`
  has the numbers.

## What does not carry over

- **The four-grey rule is a Blender presentation rule.** In the engine, greys are
  `tint` and the material. `agents/art.md` and the project's art language decide
  the palette; do not ship a level painted `10/30/70/90`.
- **The plan view with the ceiling hidden** has no engine equivalent yet. Use
  the editor's orthographic view, or `run see.sketch` for a flat-colour layout
  frame drawn with no renderer at all.
