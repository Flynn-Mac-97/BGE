---
skill: animation-states
description: Sets up and runs a rigged 3D character's animation graph — which take plays in which state (idle, walk, run, crouch, turns), sets of actions layered over it (a sword slash, a shield block), and items held by constraints. Use to wire takes into a character, build or fix its state graph, add a weapon or action set, or when a character plays the wrong clip.
triggers: animation state, state graph, state machine, animator, locomotion, idle variety, hold item, held item, wield, grip, socket, action layer, attack animation, slash, block, animation set, which clip plays, set up animations
match: plugins/builtin/animation-states.js, plugins/builtin/animation-states/*.js, **/*.states.json, **/*.set.json, **/*.hold.json
category: gameplay
---

# Animation States

A character's animation is three kinds of file, all JSON under `assets/`:

| file | what it is |
|---|---|
| `animation/<name>.states.json` | the graph: states, their takes, transitions in priority order |
| `animation/sets/<set>.set.json` | a module: actions played as a layer over any state, and states whose takes it swaps |
| `models/items/<item>.hold.json` | how an item is held, and the set it turns on (`set`) |

The type names the graph: `animationStates: 'animation/hero.states.json'`
(beside `rig: { skeleton, rootMotion: false }`). Game code sets three
things, never a clip:

```js
entity.animationInputs = { moving, gait, crouched, turning }   // what the transitions read
entity.heldItem = 'sword'                                      // null lets go; offHandItem for the other hand
entity.animationAction = 'attack'                              // a request, taken when read
const speed = context.animationStates.travelOf(entity)         // move at this so feet do not slide
```

Setting one up for a person: follow `animation-states.agent/setting-up.md`.
It starts with `animation.scaffold`, so there is a graph that plays before
anything is asked.

## Commands

- `animation.scaffold '{"folder":"motion/hero","name":"hero","skip":["slash"]}'` — a graph from a folder of takes.
- `animation.graph '{"type":"player"}'` — the graph in words, the inputs to set, its problems, and a flowchart to show the person.
- `animation.load` — read every file and load every take; a headless run awaits it before it simulates.
- `animation.state`, `animation.hold`, `animation.act`, `animation.library`, `animation.reload`.

The **Animation States** panel shows each body's state, its transitions from
here, item and action buttons, and **Reload** after a file is edited.

## Detail

- `plugins/builtin/animation-states.agent/setting-up.md` — the steps, and what to ask the person
- `plugins/builtin/animation-states.agent/files.md` — every field of the three files
