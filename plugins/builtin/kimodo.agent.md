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

## The studio

Make and design takes in **Kimodo Studio**, a project of Kimodo's own at
`<projects folder>/kimodo-studio`, not in a game. **Open Kimodo Studio** on
the board, or `kimodo.studio`, makes it on first use and opens it. Its model
is `models/kimodo-mannequin.glb`: Kimodo's own soma-30 skeleton as flat grey
boxes. It rests in soma's
standing pose with its feet at 0, so the board shows the pose Kimodo made,
not a retargeted copy. `kimodo.studio` in a studio that exists brings the
mannequin up to date and retargets its takes onto it. Nine joints are renamed so the designer finds
the limbs (soma's `LeftLeg` is the thigh; the mannequin's is the shin). Its
bone map is `assets/motion/maps/kimodo-mannequin.json`. It starts with one
take, `kimodo-idle`.

**Copy to** on a chosen take, or `kimodo.copy`, gives a game the take's stored
motion and retargets it onto every skinned model in the game's
`assets/models/`. It refuses when the game has other stored motion of that
name. The mannequin, the studio and the copy are in
`plugins/builtin/kimodo/mannequin.mjs` and `studio.mjs`.

- `kimodo.studio` — make the studio if it is missing, and open it.
- `kimodo.copy '{"clip":"motion/kimodo-mannequin/take-a.json","game":"arena-brawler"}'` — run in the studio.

## Takes

Make several takes of one move as `take-<move>-<id>`, each with its own
`--seed` or prompt. Write the prompt as `kimodo.agent/writing-a-prompt.md`
says: "A person …", one or two actions, mid detail. The same prompt, seed and frame count give the same motion.
The **KIMODO** board in the top bar lists every clip under `assets/motion/`,
plays the picked one on `models/<folder>.glb` in a view of its own, and shows
its prompt. **Use as** copies the take over a clip beside it.

The board lists takes as a grid of stills, each the take's middle pose;
picking one plays it, and **Delete** (click twice) removes it.

- `kimodo.takes` — every clip, its prompt, frames and length. **Read** after a new take.
- `kimodo.delete '{"clip":"motion/<model>/take-a.json"}'` — delete a take and, unless another clip names it, its stored motion.
- `rig.faults '{"file":"motion/<model>/take-<move>-<id>.json","skeleton":"motion/<model>.skeleton.json"}'` — judge a take before using it (Rig Animation's `judging-a-clip.md`).
- `kimodo.view '{"clip":"motion/hero/take-slash-a.json"}'` — play one on the board.
- `kimodo.use '{"clip":"motion/hero/take-slash-a.json","as":"slash"}'` — make it the clip.

## Design a move on the board

**New move** on the board, or `kimodo.new`, opens a fresh design from words
on the studio mannequin. Its **Kimodo** section picks the Kimodo model
(`kimodo.models` lists all four and which are installed; the skeleton must
match the rig), the rig (any model with a skeleton file) and the start: words
only, or a take on that rig. A new rig clears the keys, which are points on
the old one. **takes** makes that many takes per Generate, one per seed:
`take-<name>-a`, `-b`, ...

A person designs a move; an agent opens the board and generates it.
**Design on this take** on the board, or `kimodo.design`, puts the model in
design mode over a base take:

- Drag a hand or foot handle in the view; it is keyed at the time shown.
  Between keys the limb follows a curve, posed with the game's own reach solver.
- The ring round the pelvis moves the hips anywhere (body `height` and
  `ground`). Feet with no key stay planted and the legs bend; dropping the ring
  keys each foot where it stands, so Kimodo plants it too. Every foot keeps
  the turn the take gives it however the leg bends (`holdFootTurns`), as
  Kimodo keeps a keyed foot's turn from the take.
- The diamonds are elbow and knee targets (`RightElbow`, `LeftKnee`, ...): the
  joint bends toward one. An unkeyed knee bends forward. **Save** writes where
  each targeted joint then is as `solved`, sent to Kimodo as `point` keys.
- **photo pose** in Keys keys a pose record from Image Models
  (`assets/poses/*.json`) at the board's time: wrists and ankles as the hands
  and feet, elbow and knee targets past each joint, the hips' height, the
  chest's lean and the head's look, scaled to the rig's hips
  (`kimodo/pose-keys.js`; `kimodo.key-pose '{"pose":"...","at":0.5}'`).
- Chest and Head set the lean and the look (`body-rig.js` `poseBody`); a body
  field no key sets is left alone.
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
- A design with `segments: [{ prompt, seconds }]` in place of `prompt` makes
  one longer take of several prompts in a row (`writing-a-prompt.md`).
  No keys are used with it.
- `node bin/engine.mjs --headless --project <project> run kimodo.generate '{"design":"assets/motion/designs/<name>.json"}'` — about two minutes for 60 frames.

A lane page never writes files, so Save fails there; test saving in the editor.
The base take must be one Kimodo made: its stored motion is the template.

## Pose a move by name

`kimodo.pose` writes a design from named key poses at times ("guard, wind-up
at 0.5 s, strike-down at 0.9 s"), `kimodo.generate` makes it, and
`kimodo.compare` says how close each key came in centimetres. A picture of a
pose is read into the same terms. `kimodo.agent/posing.md` has the vocabulary
and the dials.

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
- `plugins/builtin/kimodo.agent/posing.md` — key poses by name, their dials, reading a picture into them, and kimodo.compare
- `plugins/builtin/kimodo.agent/writing-a-prompt.md` — the prompt rules, and what upstream Kimodo does that this checkout does not use yet
- `plugins/builtin/kimodo.agent/making-a-clip.md` — generating a clip from a written description, with hands, feet or poses held by constraints
- `plugins/builtin/kimodo.agent/interfaces.md` — the command line and the library, and which to use
- `plugins/builtin/kimodo.agent/skeletons.md` — the skeletons it knows and how to add one
- `plugins/builtin/kimodo.agent/measured-walk.md` — measured numbers from a soma-rp-v1.1 walk
