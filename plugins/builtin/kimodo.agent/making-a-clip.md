# Making a clip

```sh
node tools/make-rig-clip.mjs --project <project> --prompt "a person walks forward" --name walk --onto models/hero.glb
```

Three doors, in the order the tool tries them:

| flag | door |
|---|---|
| `--from <directory>` | buffers already written. No kimodo needed |
| `--server http://127.0.0.1:8094` | the demo server, if one is running |
| neither | the `kmd-generate` binary under `KIMODO_HOME` |

## With constraints

`--constraints <file.json>` holds a hand or foot at given points, a stored
pose at given seconds, or a stored ground path. The model is told these, so
the motion comes out through them rather than being bent to them after. It
needs the binary door and the constraints patch (`install-kimodo.mjs` applies
it).

```json
{
  "template": "slash",
  "scale": 1,
  "constraints": [
    { "kind": "pose", "at": [0] },
    { "kind": "root" },
    { "kind": "joint", "joint": "RightHand", "keys": [{ "at": 1, "value": [-0.5, 1.5, -0.05] }] }
  ]
}
```

- `template` is stored motion under `assets/motion/source/`. The body's place,
  height and heading at each constrained frame are read from it, as upstream
  Kimodo does. Name a new take with `--name`; the template is refused as its
  own output.
- `joint` is `LeftHand`, `RightHand`, `LeftFoot` or `RightFoot`. Its `keys`
  are curve keys: `at` in seconds, `value` in the model's own space (metres,
  +Z forward, feet at 0, no root motion). A Worn Gear path's keys fit as they
  are. `scale` turns model metres into capture metres: capture hips height
  over model hips height.
- `pose` keeps the template's whole body at those seconds, to start or end on
  a known stance. `root` keeps its ground path and heading on every frame.
- Keys are exact only at their frames. Between keys the model is free.
- `path` keeps the ground point under the hips on a curve of `[x, z]` keys,
  every frame, with `heading` (radians, 0 faces +Z) if given. It needs no
  template. Use it to make a walk or run straight, at a known speed.
- Keep a path at 4 m/s or less. At 6 m/s the soma model floats the body
  0.2–0.4 m off the floor and hunches. Play a slower clip faster for a faster
  game speed: rate = game speed / clip speed.

`tools/lib/motion-conditions.mjs` builds the features; the take's directory
keeps `constraints.json`, `observed.f32` and `mask.f32` beside the motion.

Other flags: `--frames 150 --steps 100 --seed 0 --model soma-rp-v1.1 --fps 30 --up z --scale 1 --map <file.json> --skeleton soma-30`. `--onto`, `--source` and the rest are in the Rig Animation guide's `making-a-clip.md`.
The frame and step defaults are the demo server's own.

**Do not cut `--steps` to make a run finish sooner.** 150 frames at 100 steps
takes 199 s on this CPU; at 10 steps it takes a fifth of that and the motion is
a shuffle. Measured on one walk: the planted foot slid 0.131 m/s against 0.061,
and the feet cleared the floor by 0.172 m against 0.217. Diffusion is 1.8 s a
step and about 90% of the runtime; the rest is the text encode, a flat 18 s.

**The CPU build is the slow path, by the source's own account** — `ggml_weights.cpp`
says "Vulkan is the normal inference path. Keep the CPU backend as a portability
fallback." `install-kimodo.mjs` builds CPU only because the Vulkan backend needs
the SDK for headers and `glslc`. Install that and rebuild with `--vulkan` to use
a GPU; `KIMODO_BACKEND=cpu` forces either half back onto the processor.

Four models can be downloaded: `soma-rp-v1.1`, `soma-seed-v1.1`, `g1-rp-v1`,
`g1-seed-v1`. The download script does not offer SMPL-X.
