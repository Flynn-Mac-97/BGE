---
name: glass-place
description: Puts an entity of a type into the open level at a point, from a drop gesture or one command. Use to place things while editing, never to spawn during a run.
---
<!-- generated from plugins/builtin/place.agent.md at server start; edits are lost -->

# Place And Attach

- Owns the two drop gestures on the viewport and the one command behind them. It adds an entity to the **open level**; it does not spawn anything for a run.
- One command, `place.at`:

```sh
node bin/engine.mjs run place.at '["coin", 4, 2]'
# -> { "id": "coin-7", "type": "coin", "at": [4, 2] }
```

| argument | default | meaning |
|---|---|---|
| type | **required** | must be a registered type, or it throws `no type "<name>"` |
| x | `0` | world metres, snapped to the nearest half unit |
| y | `0` | world metres, snapped to the nearest half unit |

- **There is no z argument. Every placement is written at `z: 0`.** For a third coordinate, write `at: [x, y, z]` into the level file and reload it.
- Dragging from the Project panel does the same work. Where you let go decides what it means:

| dragged | dropped on | result |
|---|---|---|
| a type | anywhere | placed there |
| a behaviour | an entity | runs `behaviour.attach` on the front-most hit — the one a click would select |
| a behaviour | empty space | refused, with `[place] "<name>" needs an entity — drop it on one` |

- A placement then **selects the new entity, saves the level, and redraws**. There is no separate save step.
- It refuses once the world has been simulated: `{ skipped: 'simulated' }` and a warning. A level records starting state, so a mid-run placement would be lost on the next stop. Stop first.
- **Emits no events.** Listens for `shell:ready` to attach its `dragover` / `dragleave` / `drop` handlers, once — the viewport does not exist at load time. A headless world attaches nothing and still answers `place.at`.
- The drag payload is the data type `application/x-engine`, carrying `{ kind: 'type' | 'behaviour', name }`. Anything else on the drop is ignored.
- **In a 3D view a drop loses the depth.** `renderer.toWorld` returns the full `{x, y, z}` the ray hit, and only `x` and `y` are used. Drag in a flat view, or type the position.
