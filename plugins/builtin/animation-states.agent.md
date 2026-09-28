---
skill: animation-states
description: Chooses which clip a rigged 3D body plays with a state machine declared on its type (idle, walk, run, crouch, turns), picks among several takes of a state for variety, and holds items (a sword, a two-handed sword, a shield) by constraints over the clip. Use to wire clips into a character, add a movement state, give a character something to hold, or when a character plays the wrong clip.
triggers: animation state, state machine, animator, locomotion, blend states, idle variety, hold item, held item, wield, grip, socket, shield on forearm, two handed, which clip plays
match: plugins/builtin/animation-states.js, plugins/builtin/animation-states/*.js, **/*.hold.json
category: gameplay
---

# Animation States

It runs before Rig Animation each fixed step. Game code sets inputs and the
held item; it never names a clip.

```js
rig: { clips: { 'idle-a': 'motion/hero/idle-a.json', ... }, skeleton: 'motion/hero.skeleton.json', rootMotion: false },
animationStates: {
  start: 'idle',
  states: {
    idle: { clips: ['idle-a', 'idle-b'] },        // one picked at random on entry
    walk: { clips: ['walk-a'] },
    'turn-left': { clips: ['turn-left-a'], then: 'idle', turns: true },   // once, then idle; the turn moves into entity.yaw
    dead: { clips: ['death-a'], hold: 0 }        // lets go of the held item
  },
  transitions: [                                 // priority order: the first that matches names the state
    { to: 'walk', from: ['idle'], when: { speed: { above: 0.2 } } },
    { to: 'idle', when: { speed: { below: 0.2 }, crouched: false } }
  ],
  items: 'models/items'                          // where hold records are (the default)
},
update(entity, seconds, context) {
  entity.animationInputs = { speed, crouched }
  const travel = context.animationStates.travelOf(entity)   // m/s the clip's feet cover
}
```

- `when` values match when equal, or `{ above }`, `{ below }` a number. `done` is set by the machine: the state's clip has ended.
- `entity.animationState` is the state; `entity.rigClip` is written here each step.
- Move the body at `travelOf(entity)` so the feet do not slide.
- A machine with a missing state or clip plays nothing and is reported once; `animation.states` lists the problems.

## Held items

`entity.heldItem = 'sword'` holds `assets/<items>/sword.hold.json`; `null`
lets go. The record's shape is at the top of `animation-states/held-items.js`:
a hand, a guard in front of the chest, and a grip — sockets (each hand locked
to a place and turn on the item) or a mount (the item rides a bone, a shield
on the forearm). It writes `entity.rigConstraints` and `entity.attachments.held`
while an item is held; use `entity.rigControls` for game constraints then.

A new item is a new `.hold.json` beside its model. Set its grip on the Kimodo
board (**hold** under a take, then **Save hold**); a grip fits the rig it was
set on.

## Commands

- `animation.states` — each type's states and problems.
- `animation.state '{"id":"player"}'` — state, clip, inputs and held item now.
- `animation.hold '{"id":"player","item":"shield"}'` — hold or let go.
- `animation.items` — items that have a hold record.

The **Animation States** panel shows each body's state live and holds items.
