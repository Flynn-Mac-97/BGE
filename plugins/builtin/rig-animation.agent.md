---
skill: rig-animation
description: Plays a baked motion clip on the named nodes of a 3D model — walk, idle, any capture. Use for character or skeleton animation, mocap clips, rigs, bones, and anything that animates a 3D body.
triggers: rig, rigged, skeleton, skeletal, bone, bones, mocap, motion capture, motion clip, character animation, walk cycle, idle animation, animate 3d, text to motion, pose
match: plugins/builtin/rig-animation.js, tools/make-rig-clip.mjs, tools/lib/motion-clip.mjs
---

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

## Making a clip

`node tools/make-rig-clip.mjs --prompt "a person walks forward" --name walk`
writes `project/assets/motion/walk.json`. It needs kimodo.cpp — see the
**Kimodo** guide. `--from <directory>` builds a clip from buffers that already
exist and needs no generator at all.

Clip file: `nodes` are target model node names, `rotations` is one array per
frame of four numbers per node, `root` is one `[x, y, z]` per frame.

## Retargeting — `--map <file.json>`

A capture's skeleton is not your model's. The map says which captured joints
feed which node, and it is applied when the clip is baked, never at runtime.

```json
{
  "_why": "a key starting with _ is a note, not a joint",
  "legLeft":  { "node": "legLeft", "from": ["LeftLeg"] },
  "torso":    { "node": "torso",   "from": ["Spine1", "Spine2", "Chest"] },
  "armLeft":  { "node": "armLeft", "from": ["LeftShoulder", "LeftArm"],
                "offset": [0, 0, 0.7071068, 0.7071068] }
}
```

- `"LeftLeg": "legLeft"` is the short form of one joint to one node.
- **`from` composes a chain into one bone.** A rig with one torso bone needs the
  whole spine; a single joint of it understates the lean.
- **`offset` is a standing correction for a different rest pose,** multiplied on
  after the capture's rotation. SOMA rests in a T-pose with its arm bone along
  +X; a rig whose arms hang down needs a quarter turn about Z, opposite signs
  left and right. Get this wrong and the limb is 90° out in every frame.
- Only the nodes the map names reach the clip. Everything else is dropped.
- Leave out the root joint — its rotation is the captured body's facing, which
  the game usually decides itself.
- Bind-pose offsets for every captured skeleton are in `tools/lib/skeletons.json`,
  which is how to tell which way a joint rests.
