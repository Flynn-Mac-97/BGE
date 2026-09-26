# Constraints

Constraints change the pose after the clip and the layer, in the fixed step.
The type's `rig.constraints` hold for every entity of it (planted feet), and
are solved first; then `entity.rigConstraints`, what game code asks for this
step (a reach). A headless run poses exactly as the page draws, and a test can
read the result in `entity.pose`.

They need the model's skeleton. `rig.retarget` writes it as
`motion/<model>.skeleton.json` and prints the `rig.skeleton` line; for clips
made before that, `run rig.skeleton '{"model":"models/hero.glb"}'`.

```js
rig: {
  ...,
  skeleton: 'motion/hero.skeleton.json',
  constraints: ['Left', 'Right'].map(side => ({ kind: 'plant', nodes: [`${side}UpLeg`, `${side}Leg`, `${side}Foot`] }))
}

entity.rigConstraints = [{
  kind: 'reach',
  nodes: ['mixamorig:RightArm', 'mixamorig:RightForeArm', 'mixamorig:RightHand'],
  target: { node: 'mixamorig:Hips', at: [-0.19, 0, 0] },
  weight: 0.6
}]
```

The list is solved in order, so a later constraint sees what an earlier one
did: the bow arm first, then the hand on its string.

## Kinds

| kind | what it does |
|---|---|
| `reach` | bends three nodes (upper, lower, end) so the end touches `target`. Two-bone IK. `weight` 0 is the pose, 1 is touching. The joint keeps the side it bends to, unless `pole` (any target shape) names the side. A target past the limb's length is reached towards, straight-armed. |
| `lookAt` | turns one `node` so its `forward` axis (its own +Z by default) points at `target`, at most `limit` degrees (70) from the pose. |
| `plant` | a foot the clip holds within `lift` m (0.05) of its rest height stays where it touched the world; the leg bends to it. It lets go over `blend` s (0.1) when the clip lifts it, or when it is more than `letGo` m (0.3) from the clip's foot, and plants again once faded, so it never jumps. Stops sliding on turns and stops; a run whose clip stride does not match the speed still slides. |

Each kind is a file in `plugins/builtin/rig-animation/solvers/`. To add one,
add a file and a line in `SOLVERS` in `constraints.js`. A solver that must
remember between steps gets its own `memory` record.

## Targets

| target | meaning |
|---|---|
| `{ node, at? }` | a point in that node's own space |
| `{ attachment, at? }` | a point in that attachment's model space, where it hangs now: a bow's string |
| `{ point: [x, y, z] }` | a point in the world |

- `context.rigAnimation.pointOf(entity, target)` answers where any target is now, in model space: `{ node: 'RightHand' }` is the hand. A test checks a reach with it.
- Ramp `weight` yourself; an empty list leaves the pose alone.
- A constraint changes only nodes the clip poses.
- Code: `plugins/builtin/rig-animation/constraints.js`, the solvers in `solvers/`, over `skeleton.js`, `targets.js` and `turns.js`.
