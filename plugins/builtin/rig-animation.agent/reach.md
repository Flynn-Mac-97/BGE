# Reach

`entity.rigReach` bends a chain of three named nodes after the pose, so the
last one touches a target. It is two-bone inverse kinematics, drawn only:
game code owns the weight over time, so the data is the same headless.

```js
entity.rigReach = {
  nodes: ['mixamorig:RightArm', 'mixamorig:RightForeArm', 'mixamorig:RightHand'],
  target: { node: 'mixamorig:Hips', at: [-0.19, 0, 0] },
  weight: 0.6
}
```

| target | meaning |
|---|---|
| `{ attachment: 'sword-1' }` | where that attachment hangs this frame |
| `{ attachment, at }` | a point in that attachment's model space: a bow's string |
| `{ node, at }` | a point in that node's own space |
| `{ point: [x, y, z] }` | a point in the world |

- `weight` 0 is the pose as it was, 1 is touching. Ramp it in and out yourself.
- The joint keeps the side it bends to in the pose, so an elbow does not flip.
- `pole`, any target shape, names that side instead: an archer's elbow up and back.
- A target past the limb's reach is reached towards, straight-armed.
- A list of records bends each chain in turn: both arms on a bow.
- `null`, or a weight of 0, leaves the pose alone.
- Code: `engine/render/model-reach.js`, called after attachments in `engine/render/entity-sync.js`.
