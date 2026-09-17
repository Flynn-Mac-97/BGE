# Retargeting

Capture joints are not your model's bones. `--onto` and `rig.retarget` move
motion onto a model through its rest pose; nothing is retargeted at runtime.

## How it works

- Each mapped limb bone takes the capture joint's world turn, applied after the turn that lays the bone's rest direction along the joint's rest direction. Its local rotation is whatever that needs under its parent, so any hierarchy works — Rigify DEF bones parented to control bones included.
- A bone's direction runs to the next mapped joint below it in the capture. `"aim"` picks one when there are several, as at the chest.
- Hips, spine, neck, head and shoulders are not lined up. Their rest shape is the model's anatomy, so they move by the motion's change from the capture's standing stance (`tools/lib/skeleton-neutral.json`). Lining them up caves a rib cage in. The hips also rise and fall with the capture's, scaled by rest hip height.
- A new capture skeleton needs its stance in `skeleton-neutral.json`: each of those joints' mean local rotation over a standing clip. Without one, those bones move from the capture's bind and the torso bends.
- A bone hung off a bone the map never names (Rigify's DEF-upper_arm under ORG-shoulder) is held at its rest offset from the bone its capture parent drives. The clip carries its local position in `positions`; without it the arm stays put while the chest turns.
- A deforming bone the map misses and no mapped bone carries (Rigify's DEF-pelvis.L under ORG-pelvis) follows the mapped bone whose rest head is nearest, turning and moving with it.
- The capture's mean facing is removed; its sway stays. The capture is then turned to the model's facing, read from heel to toe in quarter turns. `rig.retarget` reports it as `facing.yaw`.
- A looping clip keeps only the frames between its two best matching poses.
- Both skeletons must be Y-up.

## Bone maps

Searched in order; the first whose nodes the model all has is used:

1. `<project>/assets/motion/maps/<model name>.json`, then any other map there.
2. `tools/lib/rig-maps/<skeleton>-to-<rig>.json` — shared by every game.
3. None fits: `tools/lib/rig-map-guess.mjs` guesses from node names (hips, spine,
   neck, head, clavicle, upperarm, forearm, hand, thigh, calf, foot, toe, with a
   left or right mark) and writes step 1's file, with `_unmatched` joints listed.
   It prefers `DEF-` bones when the rig has them and skips twist and roll bones.

Edit the written map and run `rig.retarget` again. A convention every game will
meet belongs in `tools/lib/rig-maps`. Shape:

```json
{
  "_what": "a key starting with _ is a note",
  "Hips":   { "node": "pelvis" },
  "Chest":  { "node": "spine_03", "aim": "Neck1" },
  "Neck1":  { "node": "neck_01" },
  "LeftArm": { "node": "upperarm_l" }
}
```

- One capture joint per entry. Map deform bones; twist bones and fingers follow their parents.
- Node names are as the `.glb` stores them (`mixamorig:Hips`, `DEF-spine.001`).
- Put the neck entry before the shoulders, or give the chest an `aim`.
- Joint names and rest offsets for every capture skeleton are in `tools/lib/skeletons.json`.
- Pass a map of your own with `--map <file.json>` or `rig.retarget '{"map":{...}}'`.

## The plain map

Without `--onto` or `--rest`, `--map` copies local rotations and can compose a
chain into one bone (`"from": ["Spine1", "Spine2", "Chest"]`) with a standing
`"offset"` quaternion. Use it only for a rig built from rigid parts whose bones
rest with the capture's axes.
