/**
 * Reach: bend a chain of three nodes — upper, lower and end, such as an arm, a
 * forearm and a hand — so the end touches a target.
 *
 *   { kind: 'reach', nodes: [upper, lower, end], target, weight, pole? }
 *
 * `weight` 0 is the pose as it was, 1 is touching. Two-bone inverse
 * kinematics: the joint keeps the side it bends to now, or the side of `pole`
 * (any target shape) when one is given. A target past the limb's length is
 * reached towards, straight-armed.
 */
import { placeOf, posedNames, turnNodeTo } from '../skeleton.js'
import { pointOf } from '../targets.js'
import { add, dot, lengthOf, multiply, scaled, subtract, turnBetween, unit } from '../turns.js'

/** How far short of its full length a limb stops, so it never locks straight. */
const LONGEST = 0.999

/** Solve one reach over the entity's pose. Answers why it could not, or null. */
export default function solveReach(entity, skeleton, reach) {
  const weight = Math.min(1, Math.max(0, Number(reach.weight) || 0))
  if (weight === 0) return null
  const chain = posedNames(skeleton, entity.pose, reach.nodes)
  if (chain?.length !== 3) return `reach needs three nodes the clip poses, got ${JSON.stringify(reach.nodes)}`
  const target = pointOf(entity, skeleton, reach.target)
  if (!target) return null
  const pole = reach.pole ? pointOf(entity, skeleton, reach.pole) : null
  bendChain(skeleton, entity.pose, chain, target, pole, weight)
  return null
}

/**
 * Bend `[upper, lower, end]` so the end is at the model-space point `target`,
 * blended by `weight`; the joint towards `pole` when it is not null.
 */
export function bendChain(skeleton, pose, [upper, lower, end], target, pole, weight) {
  const joint = jointFor(
    placeOf(skeleton, pose, upper).position,
    placeOf(skeleton, pose, lower).position,
    placeOf(skeleton, pose, end).position,
    target,
    pole
  )
  turnTowards(skeleton, pose, upper, placeOf(skeleton, pose, lower).position, joint, weight)
  turnTowards(skeleton, pose, lower, placeOf(skeleton, pose, end).position, target, weight)
}

/** Where the middle joint goes: both lengths kept, on the side of `pole`, or else the side it bends to now. */
function jointFor(upperAt, lowerAt, endAt, target, pole) {
  const upperLength = lengthOf(subtract(lowerAt, upperAt))
  const lowerLength = lengthOf(subtract(endAt, lowerAt))
  const toTarget = subtract(target, upperAt)
  const distance = Math.min(Math.max(lengthOf(toTarget), 1e-4), (upperLength + lowerLength) * LONGEST)
  const direction = unit(toTarget)
  // The joint's offset from the straight line, which is the side it bends to.
  const offset = subtract(pole ?? lowerAt, upperAt)
  const across = subtract(offset, scaled(direction, dot(offset, direction)))
  const side = lengthOf(across) < 1e-4 ? unit(subtract([0, -1, 0], scaled(direction, -direction[1]))) : unit(across)
  const cosine = (upperLength ** 2 + distance ** 2 - lowerLength ** 2) / (2 * upperLength * distance)
  const angle = Math.acos(Math.min(1, Math.max(-1, cosine)))
  return add(
    add(upperAt, scaled(direction, Math.cos(angle) * upperLength)),
    scaled(side, Math.sin(angle) * upperLength)
  )
}

/** Turn node `name` about its own position so the point now at `now` moves to `wanted`, blended by `weight`. */
function turnTowards(skeleton, pose, name, now, wanted, weight) {
  const place = placeOf(skeleton, pose, name)
  const turned = multiply(turnBetween(subtract(now, place.position), subtract(wanted, place.position)), place.turn)
  turnNodeTo(skeleton, pose, name, turned, weight)
}
