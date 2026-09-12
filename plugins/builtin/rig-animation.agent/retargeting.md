# Retargeting — `--map <file.json>`

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
