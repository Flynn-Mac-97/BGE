# Constraints

## Controls

A type names its controls once; game code moves them by name, never a bone.

```js
rig: {
  controls: {
    rightHand: { kind: 'limb', nodes: ['RightArm', 'RightForeArm', 'RightHand'], pole: { node: 'Spine2', at: [-0.45, -0.25, -0.5] } },
    head: { kind: 'aim', node: 'Head', limit: 60 }
  }
}
entity.rigControls = { ...entity.rigControls, rightHand: { target, weight: 1 } }
```

- `limb` becomes a `reach`, `aim` a `lookAt`. A pole in a body node's space makes the elbow or knee follow the body.
- A request may name its own `pole`, and may be a list, solved in order on the same limb. An `aim` request may name its own `forward`: a hand aiming a held blade along the blade's axis.
- A request may follow a **path** instead of a target: curve keys of points (`context.curve` keys), in model space, or in `node`'s space when it names one. `startedAt` is the world time it starts, `speed` (1) scales it, and the control fades in and out over `fade` path seconds (0.15) at its ends. Set it once; Rig Animation moves along it each step. `see.capture` with `rig: true` draws the whole path as a thin line in its kind's colour: look at it before you trust one.

```js
entity.rigControls = { ...entity.rigControls, rightHand: {
  path: [{ at: 0, value: [-0.14, 1, 0.28], ease: 'quad-in' }, { at: 0.3, value: [0.05, 1.25, 0.6] }],
  startedAt: context.time
} }
```
- Set only the controls you own (spread the rest): two systems can move different controls.
- `context.rigAnimation.rigOf(entity)` answers the rig in world points; See draws it with `rig: true`.

## Constraints

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
| `orient` | gives one `node` a whole turn: its own `forward` axis (+Z) along `aim`, then its `up` axis (+Y) turned about it toward `upAim`. Directions are in model space, or in node `in`'s space. A hand on a hilt: thumb side along the blade, back of the hand out. A `lookAt` leaves the roll free; this sets it. |
| `twist` | turns a chain of `nodes`, listed lowest first, by one model-space `turn` shared evenly along it; the top node ends with the whole turn. A spine turned and leaned after a swung item. Put it before a `reach`, so the hands still reach. |
| `plant` | a foot the clip holds within `lift` m (0.05) of its rest height, and moves slower than `still` m/s (0.5) counting the clip's own travel, stays where it touched the world; the leg bends to it. It lets go over `blend` s (0.1) when the clip lifts it, or when it is more than `letGo` m (0.3) from the clip's foot, and plants again once faded, so it never jumps. Stops sliding on turns and stops. A foot the clip itself slides (a fast run) is left to the clip rather than locked and popped; move the body at `travelOf` so it does not slide. |

Each kind is a file in `plugins/builtin/rig-animation/solvers/`. To add one,
add a file and a line in `SOLVERS` in `constraints.js`. A solver that must
remember between steps gets its own `memory` record.

## Targets

| target | meaning |
|---|---|
| `{ node, at? }` | a point in that node's own space |
| `{ attachment, at? }` | a point in that attachment's model space, where it hangs now: a bow's string |
| `{ model: [x, y, z] }` | a point in model space: it turns and moves with the entity, not with a bone. A swing path. |
| `{ point: [x, y, z] }` | a point in the world |

- `context.rigAnimation.pointOf(entity, target)` answers where any target is now, in model space: `{ node: 'RightHand' }` is the hand. A test checks a reach with it.
- Ramp `weight` yourself; an empty list leaves the pose alone.
- A constraint changes only nodes the clip poses.
- Code: `plugins/builtin/rig-animation/constraints.js`, the solvers in `solvers/`, controls in `controls.js`, the drawn view in `rig-view.js`, over `skeleton.js`, `targets.js`, and Game Maths' `turns.js` and `space.js`.
