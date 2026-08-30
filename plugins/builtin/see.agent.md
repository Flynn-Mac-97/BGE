# See

Answers "what does it look like" in the cheapest form that answers it. Read
down; stop at the first row that answers your question.

| question | use | costs |
|---|---|---|
| counts, positions, sizes, coverage, is X on screen, do two things interpenetrate, how far apart are they | `see.describe` | nothing — computed, works everywhere |
| layout and composition, roughly | `see.sketch` | one small PNG; works everywhere |
| does it actually look right — art, light, readability | `see.capture` | a real frame; browser only |

Never ask a vision model what `describe` already answers. Vision models
miscount overlapping things and misjudge positions and distances; the sidecar
numbers are exact.

## Commands

- `see.describe '{...}'` — camera, visible entities with screen positions
  (percent, x right, y down), sizes, depth, mark numbers, off-screen counts,
  per-type coverage.
- `see.sketch '{...}'` — flat-colour frame from those facts, marks stamped.
  Headless it writes `agent-runs/see/<name>.png` + `.json`; in the browser it
  answers a `dataUrl` as well, so a panel can show it without disk.
- `see.capture '{...}'` — the rendered canvas, marks drawn on top, same files.
  Browser only; from a terminal the CLI writes the bytes it gets back.

Options, all optional:
- `camera` — any view fields to override: `{"camera":{"x":0,"y":40,"z":0,"pitch":-1.4,"fov":50,"mode":"perspective"}}`. Top-down map shot: high y, pitch -1.57.
- `subject` — an entity id; the camera frames that entity by itself. Add
  `"alone": true` to hide everything else. This is how to inspect one model.
- `between` — two entity ids: `{"between":["you","boar-3"]}` answers their
  world distance and whether their boxes touch.
- `marks: false` — clean frame, no tags.
- `name` — the output file name. Without one, level name + a frame number.

Computed, never asked of vision — these are exactly what vision models
measurably get wrong:
- `overlaps` — marked pairs whose world boxes interpenetrate (clipping).
- `occlusions` — [nearer, farther] marked pairs crossing on screen (hiding).
- `regions` — counts by type in a 3x3 named grid ("the rats are all top-left").
- `cut` on a marked entry — percent of it inside the frame, when clipped.
- `between` — distance, touching, left/right/above/below in words, and
  whether either entity faces the other in degrees.
- `light` in a capture's sidecar — mean and 4x4-cell brightness, 0-100.

## Looking at a simulated moment

One call, one world — simulate to the moment, then look:

```sh
node bin/engine.mjs --headless --project <p> script \
  '[["simulate",30],["run","see.describe"],["run","see.sketch",{"name":"at-30s"}]]'
```

Deterministic, so the same seed gives the same frame every run.

For a real-renderer frame of a played moment, drive the browser world the
same way — never by waiting: a background tab runs about one step a second,
so wall-clock sleep is not game time. `simulate` steps the clock exactly
regardless of focus:

```sh
node bin/engine.mjs play
node bin/engine.mjs simulate 8
node bin/engine.mjs run choice.pick 1     # a held world is usually a screen asking
node bin/engine.mjs simulate 22
node bin/engine.mjs run see.capture '{"name":"at-30s"}'
node bin/engine.mjs stop
```

If time will not advance, read `snapshot` — `paused` names who is holding
the clock.

## Reading a frame with a vision model

- Send the PNG and its `.json` sidecar together. The sidecar is ground truth;
  the pixels are only for what it cannot say.
- Refer to entities by mark number; answers come back in mark numbers, and
  `marks` in the command reply maps them to entity ids you can `engine.set`.
- One question per read, multiple-choice where possible. "Does mark 3 read as
  a rat or as a box, A or B" beats "describe the scene". Clipping, distance
  and brightness are already in the sidecar — never ask those.
- A subject smaller than ~5% of the frame: capture it with `subject` instead
  of squinting at the full frame — detail below ~2600px long edge is lost.

## Limits

- `coverage` sums each type's boxes before overlap, so a type layered over
  itself can exceed 100. It compares between frames; it is not screen share.
- `see.capture` from a terminal answers from whichever attached tab replies
  first. Keep ONE editor tab open. A tab that is not drawing is refused with
  an honest error and a `hidden` flag rather than returned as a blank frame.
- The capture is the tab's canvas at the tab's size — a bigger window is a
  bigger frame.

- `describe` and `sketch` compute from entity bounds — no lighting, material,
  animation or texture truth. Those need `capture`.
- HUD and screens are words already: `hud.read`, `screen.read`.
- Headless projection and the renderer derive the camera from the same view
  fields (engine/camera-project.js beside render.js `updateCamera` — change
  both together).
