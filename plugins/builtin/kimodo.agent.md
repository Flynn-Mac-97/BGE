---
skill: kimodo
description: How to install and drive kimodo.cpp, the local text-to-motion model that makes rig clips. Use to generate a 3D animation from a written description, or to build or check the kimodo install.
triggers: kimodo, text to motion, generate animation, generate motion, mocap from text, motion model, gguf motion, smplx, soma skeleton, unitree g1
match: tools/make-rig-clip.mjs, tools/install-kimodo.mjs, tools/lib/motion-clip.mjs
---

# Kimodo

What this project needs to drive **kimodo.cpp**, a C++/GGML port of NVIDIA's
Kimodo text-to-motion model. Text in, skeletal motion out. Built and run on
Windows on 2026-09-01; read its README before trusting an old line here.

**It is never part of this checkout.** It is a separate repository with
gigabytes of weights. It is cloned to `KIMODO_HOME`, which defaults to
`kimodo.cpp` beside the checkout. Nothing in the engine depends on it existing;
Rig Animation plays clip files and does not know what made them.

```sh
node tools/install-kimodo.mjs             # what is present, what is missing
node tools/install-kimodo.mjs --install    # clone, patch, build, fetch weights
```

Needs git, cmake 3.25+, ninja, python and `hf` (`pip install ninja
huggingface_hub` gives the last two — the old `huggingface-cli` name installs a
shim that refuses to run). `go` is needed only for the demo server.

## Building it

- **The build is CPU only and builds `kmd-generate` alone.** Vulkan needs the
  SDK, and the test targets link the Vulkan library whether or not it was built.
  `--vulkan` turns the backend back on.
- **Windows needs Visual Studio 2022 with the C++ tools.** `cl.exe` is not on
  PATH until `vcvars64.bat` has run, so every cmake call goes through it. The
  installer finds it with vswhere and refuses early if it is not there.
- **Upstream does not compile with MSVC.** `tools/kimodo-windows.patch` fixes
  four places: two missing `<stdexcept>` includes, a `std::filesystem::path`
  passed where a `const char *` is wanted, and a Vulkan call outside the guard
  that decides whether Vulkan was built. `--install` applies it.
- ggml's shared libraries are written to `build/release/bin`, not beside the
  binary, so it will not start without that directory on PATH.
  `make-rig-clip.mjs` puts it there.

## Making a clip

```sh
node tools/make-rig-clip.mjs --prompt "a person walks forward" --name walk
```

Three doors, in the order the tool tries them:

| flag | door |
|---|---|
| `--from <directory>` | buffers already written. No kimodo needed |
| `--server http://127.0.0.1:8094` | the demo server, if one is running |
| neither | the `kmd-generate` binary under `KIMODO_HOME` |

Other flags: `--frames 150 --steps 100 --seed 0 --model soma-rp-v1.1 --fps 30
--once --up z --scale 1 --map <file.json> --skeleton soma-30 --out <path>`.
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

## Its two interfaces

The binary, from `src/generate.cpp`:

```
kmd-generate MOTION.gguf TEXT_BUNDLE PROMPT.txt FRAMES STEPS SEED OUTPUT_DIR
```

It writes `root_positions.f32` `[frames, 3]` and `local_rotations_xyzw.f32`
`[frames, joints, 4]` — raw little-endian float32, local rotations as x,y,z,w.

The demo server, `go run ./demo -addr 127.0.0.1:8094`:

| route | is |
|---|---|
| `POST /api/generate` | `{prompt, frames, steps, seed, model, segments, transition_frames}` → an animation with an `id` and a `status` |
| `GET /api/animations` | every animation, to poll one's `status` |
| `GET /api/animations/<id>/rotations.f32` | the same buffer as the binary writes |
| `GET /api/animations/<id>/root.f32` | the same buffer as the binary writes |
| `GET /api/animations/<id>/animation.glb` | skeleton-only glTF, no mesh |

## Skeletons

Three, told apart by joint count: `smplx-22`, `soma-30`, `g1-34`. The joint
names and their order are in `tools/lib/motion-clip.mjs`, copied from
`src/skeleton.hpp`. **The order is the buffer's order** — a wrong table poses
the wrong limb and reports nothing.

## Measured, from a soma-rp-v1.1 walk

The source states none of this. It was read off the output of "a person walks
forward", 60 frames, on 2026-09-01. Re-measure if the model changes.

- **Y is up, already.** The root holds Y at 0.95–0.99 while Z runs 0 to 3.13 —
  pelvis height and forward travel. The engine draws Y-up, so **do not pass
  `--up z`**. That flag is for a capture from somewhere else.
- **Positions are metres.** A pelvis at 0.97 is a person.
- **30 frames a second** puts that walk at 1.57 m/s. The default is right.
- 60 frames of 30 joints is a 53 KB clip file.
- SMPL-X weights carry NVIDIA's Open Model License and restrict commercial use.
  The C++ port itself is Apache-2.0.
