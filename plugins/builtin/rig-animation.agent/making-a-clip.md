# Making a clip

```sh
node tools/make-rig-clip.mjs --project <project> --prompt "a person walks forward" --name walk --onto models/hero.glb
node tools/make-rig-clip.mjs --project <project> --source walk --name walk --onto models/villain.glb
node bin/engine.mjs --headless --project <project> run rig.retarget '{"model":"models/hero.glb","once":["death"]}'
```

| flag | meaning |
|---|---|
| `--prompt` | generate with kimodo; see the Kimodo guide. Stored in `assets/motion/source/<name>/` |
| `--source <name>` | use stored motion; no generator needed |
| `--onto <model>` | retarget onto that model; writes `assets/motion/<model name>/<name>.json` |
| `--once` | a clip that plays once: not trimmed to a loop |
| `--map <file>` | a bone map of your own instead of `tools/lib/rig-maps` |
| `--from <directory>`, `--rest <glb>`, `--cycle`, `--out` | the low-level path, for buffers outside a project |

Stored motion is raw kimodo output: `local_rotations_xyzw.f32`, `root_positions.f32`, `prompt.txt`. Keep it; every retarget reads it.

Clip file: `nodes` are model node names, `rotations` is one array per frame of four numbers per node, `positions` (optional) is node → one local `[x, y, z]` per frame for bones that move as well as turn, `root` is one `[x, y, z]` per frame, `source` records the prompt, the map and the capture frames `kept`.

## Checking a clip

- `rig.clips` in the editor says whether each loaded and its frame count.
- The renderer names a clip node the model has not got.
- `see.capture '{"subject":"player"}'` while it plays shows the pose.
- Compare against the capture in Blender when a pose looks wrong: pose the model's deform bones from the clip with constraints muted and B-bone segments at 1, which is what the engine can draw, beside the capture as a stick figure.
