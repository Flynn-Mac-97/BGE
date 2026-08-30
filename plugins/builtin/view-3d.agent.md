---
skill: none
---

# 3D View

- Flies the editor viewport around the level in 3D — the editor's own camera, separate from the game camera.
- Toggle with `view.3d` (or the 3D toolbar button). In the 3D view: WASD move, Q/E down/up, Shift faster, drag to look, wheel to dolly.
- The level's `camera` block is never touched — this is viewport state, like pan and zoom.
- The 3D pose is remembered across play sessions and level reloads.
