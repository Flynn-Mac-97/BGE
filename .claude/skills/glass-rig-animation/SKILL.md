---
name: glass-rig-animation
description: Plays a baked motion clip on the named nodes of a 3D model — walk, idle, any capture. Use for character or skeleton animation, mocap clips, rigs, bones, and anything that animates a 3D body.
---
<!-- generated from plugins/builtin/rig-animation.agent.md at server start; edits are lost -->

# Rig Animation

- Owns one job: on every fixed step it reads `entity.rigClip`, samples that clip,
  and writes `entity.pose`. It draws nothing — `engine/render.js` turns `pose`
  into node rotations.
- Sprite Animation's twin for 3D. Same shape: data on the type, chosen by
  assignment.

```js
// project/types/player.js
mesh: { model: 'player.glb' },
rig: {
  clips: { idle: 'motion/idle.json', walk: 'motion/walk.json' },
  default: 'idle',
  rootMotion: false
},

update(entity) {
  entity.rigClip = entity.speed > 0.1 ? 'walk' : 'idle'
}
```

| key | where | default | meaning |
|---|---|---|---|
| `rig.clips` | type | none | name → clip file. No `clips`, and this plugin skips the entity |
| `rig.default` | type | first clip | used when `entity.rigClip` is not set |
| `rig.rootMotion` | type | `false` | add the clip's own travel to `entity.x/y/z` each step |
| `entity.rigClip` | game code | — | **assign** the clip name; there is no `play()` |
| `entity.pose` | written here | — | node name → `[x, y, z, w]`, read by the renderer |
| `entity.rigRoot` | written here | — | the clip's root position this frame, in metres |
| `entity.rigDone` | written here | `false` | true once a non-looping clip reaches its last frame |

- Commands: `rig.clips` — every declared clip and whether it loaded. `rig.load` —
  load them all. `rig.play '{"entity":"player","clip":"walk"}'`.
- Verbs: `context.rigAnimation.load(file)`, `.clip(file)`, `.loadDeclared()`,
  `.forget()`.
- **A clip is a file, so it loads asynchronously.** An entity holds its last pose
  until it lands. A headless run that must be identical every time awaits
  `rig.load` before it simulates.
- **A playing clip owns `entity.pose`.** Do not write hinge angles onto the same
  entity; the next step overwrites them.
- An unknown clip name holds the last pose and says nothing. Check it against
  `rig.clips`.
- No blending between clips. Switching restarts the new one at frame zero.
- Node names in a clip must match nodes in the model. The renderer names any it
  cannot find. Retargeting is done when the clip is baked, not here.

## Detail

Read only the file your task needs.

- `plugins/builtin/rig-animation.agent/making-a-clip.md` — baking a motion clip onto a rig
- `plugins/builtin/rig-animation.agent/retargeting.md` — moving a clip onto another skeleton with `--map`
