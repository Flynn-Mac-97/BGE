# Making something you can see

Pick the cheapest option that reaches the quality the task asks for. Read down;
stop at the first row that fits. Going straight to the bottom row is how a game
ends up made of boxes.

## Geometry — a thing in the world

| want | use | cost |
|---|---|---|
| a character, creature, weapon, vehicle | **Blender** — model, export GLB to `<project>/assets/`, then `mesh: { model: '...' }` | high, and the only thing that reads as a model |
| a prop with a real silhouette | **Blender**, or search a free library first | medium |
| a composite of a few solids — a fence, a crate stack | `mesh: { parts: [...] }`, boxes with local `at` and `rotation` | low |
| a wall, floor, slab, blockout | `mesh: { box: [...] }` | none |

Blender needs the GUI open and **BlenderMCP → Connect** pressed. If it is not
connected, say so and ask — do not silently fall back to boxes. A cat built from
eighteen boxes is a cat-shaped pile of boxes, and it cost more than modelling one.

`rotation` in a level is Y-only and in degrees. Anything that needs to tip or
roll is a model, not a placement.

## Textures and flat images

| want | use | cost |
|---|---|---|
| a real surface — stone, bark, metal, fabric | **search a free library** (Poly Haven through Blender) and retint to the palette | low |
| a sprite, an icon, a UI skin, concept art | **image generation**, then save under `<project>/assets/` | low |
| a set that must obey a strict palette, tile on a torus, or band cleanly under `toon` | **write a generator** in `tools/`, seeded | high — 800 lines and several passes |

Search before you generate. Fourteen procedural textures cost roughly ten times
what downloading and retinting fourteen would have. Write a generator only when
you can say what a downloaded one would get wrong.

## Screens and interface

- A game screen — pause, upgrade cards, result — is `context.screen`. Never `ui.*`; that is editor panels.
- The HUD is `context.screen` too. Read `plugins/builtin/screen.agent.md`.
- `screen.read` says what is on screen in words, so a headless run can check it.

## Before you build

- Read the project's art language document if it has one. Four agents making
  meshes at once need one language, or the frame has two games in it.
- Look at what the engine already draws. `plugins/builtin/materials.agent.md`
  lists nine materials with every parameter; `lights.agent.md` lists every key.
- The camera decides what detail is worth paying for. Ask how far away and how
  large on screen before choosing a row above.

## When this is wrong

This table is the current best route, not a rule. Find a faster or better one and
change this file in the same task — a stale route costs every agent after you.
