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
