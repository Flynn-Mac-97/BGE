---
name: glass-kimodo
description: How to install and drive kimodo.cpp, the local text-to-motion model that makes rig clips. Use to generate a 3D animation from a written description, or to build or check the kimodo install.
---
<!-- generated from plugins/builtin/kimodo.agent.md at server start; edits are lost -->

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

## Detail

Read only the file your task needs.

- `plugins/builtin/kimodo.agent/building-it.md` — installing and building kimodo.cpp
- `plugins/builtin/kimodo.agent/making-a-clip.md` — generating a clip from a written description
- `plugins/builtin/kimodo.agent/interfaces.md` — the command line and the library, and which to use
- `plugins/builtin/kimodo.agent/skeletons.md` — the skeletons it knows and how to add one
- `plugins/builtin/kimodo.agent/measured-walk.md` — measured numbers from a soma-rp-v1.1 walk
