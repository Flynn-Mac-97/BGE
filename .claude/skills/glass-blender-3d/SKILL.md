---
name: glass-blender-3d
description: Build or change Blender meshes, rigs, UVs, materials, and game exports.
---
<!-- generated from agents/skills/blender-3d/SKILL.md at server start; edits are lost -->

# Blender 3D

## Blocking out comes first, and has its own skill

A model starts as masses, not detail. Two skills own that stage; read the one
that matches before you touch geometry.

| the job | read |
|---|---|
| one hard-surface thing — device, weapon, tool, vehicle, machine, appliance, container, furniture | `../blockout-prop/SKILL.md` |
| a space to move through — level, map, arena, street, interior, dungeon, village, camp, station, terrain, hub | `../blockout-environment/SKILL.md` |
| a character or creature | no blockout skill yet. Say so, then follow the steps below |

Each one starts with its own `in-this-engine.md`, which says whether the job is
Blender at all. A space is usually entities in a level file, not a mesh.

## Every Blender run

1. Read the asset size, style, and export needs.
2. Check the scene before changing it.
3. Use clear object and material names.
4. Keep the mesh simple enough for the browser.
5. Apply scale before export.
6. Export to `project/assets/` in the requested format.
7. Open the result in the engine and check its size and materials.

`agents/art.md` decides whether Blender is the cheapest route. Stop and explain
if no Blender tool is connected.
