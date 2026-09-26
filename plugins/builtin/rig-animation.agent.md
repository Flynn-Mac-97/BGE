---
skill: rig-animation
description: Plays motion clips on a 3D model's bones and brings any rigged character in to play them. Use for character or skeleton animation, mocap or generated clips, rigs, bones, retargeting, and anything that animates a 3D body.
triggers: rig, rigged, skeleton, skeletal, bone, bones, mocap, motion capture, motion clip, character animation, walk cycle, idle animation, animate 3d, text to motion, pose, retarget, rigify, mixamo
match: plugins/builtin/rig-animation.js, tools/make-rig-clip.mjs, tools/lib/motion-clip.mjs, tools/lib/retarget*.mjs, tools/lib/rig-*.mjs
category: assets
---

# Rig Animation

Each fixed step it samples `entity.rigClip` into `entity.pose`; the renderer poses the bones.

## Any rigged character, in order

`run` is `node bin/engine.mjs --headless --project <project> run`.

1. `run blender.inspect '{"file":"assets/models/hero.blend"}'` — `collection` and `scaleForPerson` per character.
2. `run blender.settings '{"file":"...","collection":[...],"scale":...}'`, then `run blender.import '{"file":"..."}'`.
3. Motion, once per game: `node tools/make-rig-clip.mjs --project <project> --prompt "a person walks forward" --name walk --onto models/hero.glb`. Stored in `assets/motion/source/`. A hand, foot or pose that must land somewhere: add `--constraints` (Kimodo guide) rather than fixing it with IK.
4. `run rig.retarget '{"model":"models/hero.glb"}'` — all stored motion onto it; prints `facing.yaw` and the type's `rig` block. Put `facing.faces` on the type's mesh (`mesh: { ..., faces: '+Z' }`), so See knows where its front is.
5. `run rig.check '{"model":"models/hero.glb"}'` — `ok`, or findings naming the fix.
6. A pose looks wrong: `run rig.compare '{"model":"models/hero.glb","clip":"run"}'`; read the sheet.

```js
mesh: { model: 'models/hero.glb', anchor: 'feet' },
rig: { clips: { idle: 'motion/hero/idle.json', run: 'motion/hero/run.json' }, default: 'idle', rootMotion: false },
update(entity) { entity.rigClip = entity.moveSpeed > 2.8 ? 'run' : 'idle' }
```

- Bone map: the game's `assets/motion/maps/<model>.json`, else `tools/lib/rig-maps`, else guessed from names and written there (`guessed` in the reply; read it).
- Facing comes from the feet. Unmapped deforming bones follow the nearest mapped bone.

- Type keys: `rig.clips` (name → file), `rig.default` (first clip), `rig.rootMotion` (false: the clip's travel is not added), `rig.skeleton` (the file constraints need), `rig.constraints` (constraints every entity of the type keeps: planted feet), `rig.controls` (named limbs and aims game code moves with `entity.rigControls`). Choose by assigning `entity.rigClip`; there is no `play()`. `entity.rigSpeed` (default 1) plays the chosen clip faster or slower.
- Move a body at the speed its clip travels, never at a number of your own: `context.rigAnimation.travelOf(entity, 'run')` is the clip's root speed in m/s (0 while it loads). Slow the body by a share and set `rigSpeed` to the same share, so the feet never slide.

- Clips load asynchronously (a headless test awaits `rig.load`). A playing clip owns `entity.pose`. Unknown names hold the last pose. Switching `rigClip` crossfades from the old clip over `rig.clipFade` (0.2 s).
- Blend: `entity.rigBlend = { clip, weight }` mixes a second looping clip over the base, in step (it starts at its frame nearest the base's first, and the cycle runs between both paces). Use it for a load or mood on a gait: `run` with `run-heavy`. Move the body at the two clips' `travelOf` mixed by the same weight.
- Layers: `rig.masks` names node lists; `entity.rigLayer = { clip, mask }` plays a clip on those nodes over the base, fading over `rig.layerFade` (0.12 s). `null` fades out; `rigLayerDone` marks a once clip's end. `speed` (default 1) plays it faster or slower; a new `startedAt` value plays the same clip again from its start.

## Detail

- `plugins/builtin/rig-animation.agent/checking.md` — every `rig.check` finding and how to read a compare sheet
- `plugins/builtin/rig-animation.agent/retargeting.md` — how the retarget works, writing or fixing a bone map
- `plugins/builtin/rig-animation.agent/making-a-clip.md` — clip file shape and tool flags
- `plugins/builtin/rig-animation.agent/constraints.md` — controls (`entity.rigControls`) and constraints: IK, look-at and planted feet after the clip, in the fixed step
