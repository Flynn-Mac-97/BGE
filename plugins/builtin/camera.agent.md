---
description: What the player sees and how it follows — orthographic follow, first person, third person, framing and bounds. Use when the view is wrong, the camera does not follow, or the game needs a different viewpoint.
---
# Camera

- Put camera rules in the level's `camera` block; the editor's viewport is saved on play and put back on stop.
- `mode` picks which camera runs: `ortho` (flat follow), `first-person` (eye on the body), `third-person` (held behind it).
- A third-person camera is `pitch`, `yaw` and `distance` — steep and far is top-down, shallow and near is over a shoulder.
- `lerp` eases what the camera LOOKS AT, not where it sits. `lookAhead` is seconds of travel to lead by.
- `bounds` is four numbers: x0, y0, x1, y1 flat, x0, z0, x1, z1 in three dimensions.
- Follow, move, and shake through `context.camera`. A shake turns the aim in first person and knocks the eye in third.
- Check state with `camera.state` — it reports the eye, the focus, and why it is not following anything.
- `view.follows` carries the followed entity's id, or null. It is the only kernel-visible answer to "which body is the player's"; the renderer reads it to place the ground ring.
- For a mouse-driven 3D camera use **Live Camera** (a level `cameras` list), which updates every drawn frame; give a level one or the other.
