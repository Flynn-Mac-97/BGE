---
skill: kimodo
description: How to install and drive kimodo.cpp, the local text-to-motion model that makes rig clips. Use to generate a 3D animation from a written description, to watch takes and choose one, or to build or check the kimodo install.
triggers: kimodo, motion takes, choose a take, text to motion, generate animation, generate motion, mocap from text, motion model, gguf motion, smplx, soma skeleton, unitree g1, hand path, motion constraint, keyframe pose, regenerate clip, swing path
match: plugins/builtin/kimodo.js, plugins/builtin/kimodo/*.js, tools/make-rig-clip.mjs, tools/install-kimodo.mjs, tools/lib/motion-clip.mjs, tools/lib/motion-conditions.mjs, tools/kimodo-constraints.patch
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
`--seed` or prompt. Write the prompt as `kimodo.agent/writing-a-prompt.md`
says: "A person …", one or two actions, mid detail. The same prompt, seed and frame count give the same motion.
The **KIMODO** board in the top bar lists every clip under `assets/motion/`,
plays the picked one on `models/<folder>.glb` in a view of its own, and shows
its prompt. **Use as** copies the take over a clip beside it.

- `kimodo.takes` — every clip, its prompt, frames and length. **Read** after a new take.
- `kimodo.view '{"clip":"motion/hero/take-slash-a.json"}'` — play one on the board.
- `kimodo.use '{"clip":"motion/hero/take-slash-a.json","as":"slash"}'` — make it the clip.

## Design a move on the board

A person designs a move; an agent opens the board and generates it.
**Design on this take** on the board, or `kimodo.design`, puts the model in
design mode over a base take:

- Drag a hand or foot handle in the view; it is keyed at the time shown.
  Between keys the limb follows a curve, posed with the game's own reach solver.
- The mouse wheel zooms. Dragging empty space turns the view.
- **Move** holds the prompt, length, seed, loop, and whether the take starts
  in the base take's first pose. **Hold** shows an item from
  `assets/models/items/` in the right hand; it is for the preview only.
- **Save** writes `assets/motion/designs/<name>.json` (record shape in
  `plugins/builtin/kimodo/designer.js`). **Generate take** saves, then makes
  `take-<name>` and plays it. From the page it runs in a headless engine the
  supervisor starts (`engine/headless-job.js`, route `/api/headless-job`).
- No keys and "starts in the base pose" off: the take comes from the words alone.

- `kimodo.design '{"clip":"motion/fighter/idle.json"}'` — a new design on a take; `{"file":...}` opens a saved one.
- `kimodo.designs` — the saved designs.
- `node bin/engine.mjs --headless --project <project> run kimodo.generate '{"design":"assets/motion/designs/<name>.json"}'` — about two minutes for 60 frames.

A lane page never writes files, so Save fails there; test saving in the editor.
The base take must be one Kimodo made: its stored motion is the template.

## Shape a move with constraints

A clip that misses where a hand, foot or pose must be is generated again with
constraints, not bent to fit at run time. Kimodo is told the points, so the
body moves through them.

1. Write a constraint file in `agent-runs/`: the stored take to read the body
   from (`template`), and `joint` keys in the model's own space. A Worn Gear
   action's `paths` keys go in as they are.
2. `node tools/make-rig-clip.mjs --project <project> --prompt "<the take's prompt>" --name take-<move>-<id> --frames <the take's frames> --constraints <file> --onto models/<model>.glb --once`
3. `run kimodo.use '{"clip":"motion/<model>/take-<move>-<id>.json","as":"<move>"}'`, then look at it (See).

Measured on the arena slash, 60 frames, seed 0: the hand missed its three path
keys by 27–89 cm unconstrained and 3–7 cm constrained. The file's shape and
every kind are in `kimodo.agent/making-a-clip.md`.

A retarget of the stored motion by the clip's own name (`--source slash`)
writes over a used take; keep the take's source, or use the take again.

## Detail

Read only the file your task needs.

- `plugins/builtin/kimodo.agent/building-it.md` — installing and building kimodo.cpp
- `plugins/builtin/kimodo.agent/writing-a-prompt.md` — the prompt rules, and what upstream Kimodo does that this checkout does not use yet
- `plugins/builtin/kimodo.agent/making-a-clip.md` — generating a clip from a written description, with hands, feet or poses held by constraints
- `plugins/builtin/kimodo.agent/interfaces.md` — the command line and the library, and which to use
- `plugins/builtin/kimodo.agent/skeletons.md` — the skeletons it knows and how to add one
- `plugins/builtin/kimodo.agent/measured-walk.md` — measured numbers from a soma-rp-v1.1 walk
