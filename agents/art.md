# Making something you can see

Pick the cheapest option that reaches the quality the task asks for. Read down;
stop at the first row that fits. Skipping straight to the bottom row produces a
game made of boxes.

## Geometry — a thing in the world

| want | use | cost |
|---|---|---|
| a character, creature, weapon, vehicle | **Blender** — model, export GLB to `<project>/assets/`, then `mesh: { model: '...' }` | high, and the only thing that reads as a model |
| a prop with a real silhouette | **Blender**, or search a free library first. Block it out first: `agents/skills/blockout-prop/SKILL.md` | medium |
| a space to move through — level, map, arena, interior | mostly entities in a level file. Read `agents/skills/blockout-environment/SKILL.md` before choosing | low to high |
| a composite of a few solids — a fence, a crate stack | `mesh: { parts: [...] }`, boxes with local `at` and `rotation` | low |
| a ball, a dome, a planet, anything that curves | `mesh: { sphere: r }` or `sphere: [x, y, z]` | none |
| a wall, floor, slab, blockout | `mesh: { box: [...] }` | none |

Blender needs the GUI open and **BlenderMCP → Connect** pressed. If it is not
connected, say so and ask — do not silently fall back to boxes. Boxes cost more
tokens than a model and read worse.

**`segments` subdivides a shape.** One by default, which is all a wall needs.
Raise it only for a material that moves vertices — a 4-vertex quad has nothing
to displace, so a wave shader on one does nothing at all.

`rotation` in a level is in degrees. A bare number is yaw; `[x, y, z]` is pitch,
yaw and roll, the same form `mesh.parts` takes.

## Textures and flat images

| want | use | cost |
|---|---|---|
| a real surface — stone, bark, metal, fabric | **search a free library** (Poly Haven through Blender) and retint to the palette | low |
| a sprite, an icon, a UI skin, concept art | **image generation**, then save under `<project>/assets/` | low |
| a set that must obey a strict palette, tile on a torus, or band cleanly under `toon` | **write a generator** in `tools/`, seeded | high — 800 lines and several passes |

Search before you generate. Fourteen procedural textures cost roughly ten times
what downloading and retinting fourteen would have. Write a generator only when
you can say what a downloaded one would get wrong.

## Checking what it looks like

Use the `See` plugin — `see.describe` for counts, positions and coverage
(computed, free, headless), `see.sketch` for layout as a small PNG, and
`see.capture` for the real frame with numbered marks. Read
`plugins/builtin/see.agent.md` before spending a vision read.

## Screens and interface

- A game screen — pause, upgrade cards, result — is `context.screen`. Never `ui.*`; that is editor panels.
- The HUD is `context.screen` too. Read `plugins/builtin/screen.agent.md`.
- `screen.read` says what is on screen in words, so a headless run can check it.

## Before you build

- Read the project's art language document if it has one. Parallel agents need
  one shared language or the frame mixes styles.
- Look at what the engine already draws. `plugins/builtin/materials.agent.md`
  lists nine materials with every parameter; `lights.agent.md` lists every key.
- The camera decides what detail is worth paying for. Ask how far away and how
  large on screen before choosing a row above.

## When this is wrong

This table is the current best route, not a rule. Find a faster or better one and
change this file in the same task — a stale route costs every agent after you.
