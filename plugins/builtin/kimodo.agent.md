---
skill: kimodo
description: How to install and drive kimodo.cpp, the local text-to-motion model that makes rig clips. Use to generate a 3D animation from a written description, to watch takes and choose one, or to build or check the kimodo install.
triggers: kimodo, motion takes, choose a take, text to motion, generate animation, generate motion, mocap from text, motion model, gguf motion, smplx, soma skeleton, unitree g1
match: plugins/builtin/kimodo.js, plugins/builtin/kimodo/*.js, tools/make-rig-clip.mjs, tools/install-kimodo.mjs, tools/lib/motion-clip.mjs
category: assets
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

## Takes

Make several takes of one move as `take-<move>-<id>`, each with its own
`--seed` or prompt. The same prompt, seed and frame count give the same motion.
The **KIMODO** board in the top bar lists every clip under `assets/motion/`,
plays the picked one on `models/<folder>.glb` in a view of its own, and shows
its prompt. **Use as** copies the take over a clip beside it.

- `kimodo.takes` — every clip, its prompt, frames and length. **Read** after a new take.
- `kimodo.view '{"clip":"motion/hero/take-slash-a.json"}'` — play one on the board.
- `kimodo.use '{"clip":"motion/hero/take-slash-a.json","as":"slash"}'` — make it the clip.

A retarget of the stored motion by the clip's own name (`--source slash`)
writes over a used take; keep the take's source, or use the take again.

## Detail

Read only the file your task needs.

- `plugins/builtin/kimodo.agent/building-it.md` — installing and building kimodo.cpp
- `plugins/builtin/kimodo.agent/making-a-clip.md` — generating a clip from a written description
- `plugins/builtin/kimodo.agent/interfaces.md` — the command line and the library, and which to use
- `plugins/builtin/kimodo.agent/skeletons.md` — the skeletons it knows and how to add one
- `plugins/builtin/kimodo.agent/measured-walk.md` — measured numbers from a soma-rp-v1.1 walk
