---
name: glass-live-camera
description: Play cameras that update on every drawn frame, so mouse turn and follow have no step delay — third-person orbit now, more kinds later, chosen by priority like Cinemachine. Use for any real-time 3D game camera, when a camera feels laggy or judders, when a mouse should orbit the view, or to switch between cameras during play.
---
<!-- generated from plugins/builtin/live-camera.agent.md at server start; edits are lost -->

# Live Camera

- A level lists cameras under `cameras`. Each has an `id`, a `kind`, a `priority`, and the kind's settings. The highest priority is live; the first listed wins a tie.
- It runs as a **frame** system: after the fixed steps, before the draw. Mouse turn reaches the screen on the frame it arrives.
- It reads a body at `world.drawnPlace(body, loop.blend)` — where the renderer draws it between two fixed steps — so a followed body holds still on screen at any refresh rate.
- It skips any frame where `view.borrowedBy` is set, which See sets while it aims for a picture. It owns the view while a level has cameras. Leave the level's `camera` block out, or it and Game Camera both write the view.

```json
"cameras": [
  { "id": "follow", "kind": "third-person", "follow": "player", "priority": 10,
    "distance": 5, "pitch": -0.3, "offsetY": 0.6 }
]
```

## Kinds

| kind | settings, with defaults |
|---|---|
| `third-person` | `follow` · `distance` 5 · `minDistance` 1.5 · `maxDistance` 12 · `yaw` 0 · `pitch` -0.3 · `minPitch` -1.2 · `maxPitch` 0.3 · `offsetY` 0.6 · `side` 0 · `fov` 55 · `damping` 0 · `orbit` true · `zoom` true |

- `third-person`: the mouse orbits while the pointer is locked (Mouse Look captures it on a click); the wheel zooms. `damping` is seconds of lag on the look point; 0 is locked on. `side` shifts the eye right for an over-the-shoulder view.
- Add a kind: `context.cameras.registerKind(name, { about, defaults, start(camera, context), frame(camera, seconds, context) })`. `frame` writes `context.view` and returns `{ following, problem }`.

## Verbs and commands

- `context.cameras.forward()` / `.right()` — ground directions of the live view. Move a player with these, in its fixed `update`.
- `context.cameras.activate(id)` — live regardless of priority; `null` returns to priority. `.add(definition)`, `.remove(id)`, `.list()`, `.kinds()`, `.state()`.
- `cameras.state` — live camera, what it follows, the view, `frameSeconds`, `blend`, and `problem` when it cannot follow.
- `cameras.activate '{"id":"follow"}'` · `cameras.kinds`.
- Panel **Cameras** shows the live camera and a button per camera.

## Refuses

- A camera with no `id`, or a `kind` not registered — named in the console on level load.
- A kind with no `frame` function.
