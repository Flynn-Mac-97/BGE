/**
 * Look at: turn one node so one of its own axes points at a target — a head
 * at an enemy, a torso at the aim.
 *
 *   { kind: 'lookAt', node, target, weight, forward?: [0, 0, 1], limit?: 70 }
 *
 * `forward` is the axis, in the node's own space, that should point at the
 * target; +Z when left out. `limit` is the most it turns from its pose, in
 * degrees; past it, it turns that far and no further. `weight` blends from the
 * pose, 0 to 1.
 */
import { placeOf, posedNames, turnNodeTo } from '../skeleton.js'
import { pointOf } from '../targets.js'
import { multiply, rotate, turnBetween } from '../../game-maths/turns.js'
import { scaled, subtract, unit } from '../../game-maths/space.js'

const DEGREES = Math.PI / 180

/** Solve one look-at over the entity's pose. Answers why it could not, or null. */
export default function solveLookAt(entity, skeleton, look) {
  const weight = Math.min(1, Math.max(0, Number(look.weight) || 0))
  if (weight === 0) return null
  const [name] = posedNames(skeleton, entity.pose, [look.node]) ?? []
  if (!name) return `lookAt needs a node the clip poses, got ${JSON.stringify(look.node)}`
  const target = pointOf(entity, skeleton, look.target)
  if (!target) return null
  const place = placeOf(skeleton, entity.pose, name)
  const facing = rotate(place.turn, look.forward ?? [0, 0, 1])
  const turn = limited(turnBetween(facing, subtract(target, place.position)), (look.limit ?? 70) * DEGREES)
  turnNodeTo(skeleton, entity.pose, name, multiply(turn, place.turn), weight)
  return null
}

/** A turn cut down to `most` radians about the same axis. */
function limited(turn, most) {
  const angle = 2 * Math.acos(Math.min(1, Math.abs(turn[3])))
  if (angle <= most) return turn
  const axis = unit(turn[3] < 0 ? scaled(turn, -1) : turn)
  return [...scaled(axis, Math.sin(most / 2)), Math.cos(most / 2)]
}
