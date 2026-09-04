---
name: glass-physics-3d
description: Solid bodies, collision, gravity and raycasts in 3D. Use when things fall through the floor, walk through walls, need to stand on something, or when you need to know what a line of sight or a shot hits.
---
<!-- generated from plugins/builtin/physics-3d.agent.md at server start; edits are lost -->

# Physics 3D

- Adds 3D bodies, collision, raycasts, and standing checks.
- Use real three-number positions and directions.
- Test physics in a fixed headless simulation.
- `physics3d.bodies` — every body the solver knows, with its box and its kind.
- `physics3d.raycast '{"origin":[..],"direction":[..]}'` — what a line hits first, and where.
