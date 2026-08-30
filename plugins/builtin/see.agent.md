# See

Answers "what does it look like" in the cheapest form that answers it. Read
down; stop at the first row that answers your question.

| question | use | costs |
|---|---|---|
| counts, positions, sizes, coverage, is X on screen | `see.describe` | nothing — computed, works everywhere |
| layout and composition, roughly | `see.sketch` | one small PNG; headless, no browser |
| does it actually look right — art, light, readability | `see.capture` | a real frame; browser only |

Never ask a vision model what `describe` already answers. Vision models
miscount overlapping things and misjudge positions and distances; the sidecar
numbers are exact.

## Commands

- `see.describe '{...}'` — camera, visible entities with screen positions
  (percent, x right, y down), sizes, depth, mark numbers, off-screen counts,
  per-type coverage.
- `see.sketch '{...}'` — flat-colour frame from those facts, marks stamped.
  Headless only. Writes `agent-runs/see/<name>.png` + `.json`.
- `see.capture '{...}'` — the rendered canvas, marks drawn on top, same files.
  Browser only; from a terminal the CLI writes the bytes it gets back.

Options, all optional:
- `camera` — any view fields to override: `{"camera":{"x":0,"y":40,"z":0,"pitch":-1.4,"fov":50,"mode":"perspective"}}`. Top-down map shot: high y, pitch -1.57.
- `subject` — an entity id; the camera frames that entity by itself. Add
  `"alone": true` to hide everything else. This is how to inspect one model.
- `marks: false` — clean frame, no tags.
- `name` — the output file name. Without one, level name + a frame number.

## Reading a frame with a vision model

- Send the PNG and its `.json` sidecar together. The sidecar is ground truth;
  the pixels are only for what it cannot say.
- Refer to entities by mark number; answers come back in mark numbers, and
  `marks` in the command reply maps them to entity ids you can `engine.set`.
- One question per read, multiple-choice where possible. "Is mark 3 clipping
  into mark 7, yes or no" beats "describe the scene".
- A subject smaller than ~5% of the frame: capture it with `subject` instead
  of squinting at the full frame — detail below ~2600px long edge is lost.

## Limits

- `describe` and `sketch` compute from entity bounds — no lighting, material,
  animation or texture truth. Those need `capture`.
- HUD and screens are words already: `hud.read`, `screen.read`.
- Headless projection and the renderer derive the camera from the same view
  fields (engine/camera-project.js beside render.js `updateCamera` — change
  both together).
