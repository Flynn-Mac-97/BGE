/**
 * Orient: give one node a whole turn from two directions — a hand on a hilt,
 * whose thumb side runs along the blade and whose palm faces the body.
 *
 *   { kind: 'orient', node, aim, upAim, forward?: [0, 0, 1], up?: [0, 1, 0], in?, weight }
 *
 * The node's own `forward` axis is turned onto `aim`, then about it until its
 * own `up` axis is as near `upAim` as it can be. `aim` and `upAim` are
 * directions in model space, or in node `in`'s space when it is named, so a
 * hand held from the chest turns with the chest. `weight` blends from the
 * pose, 0 to 1. A look-at aims one axis and leaves the roll free; this sets the
 * roll too.
 */
import { placeOf, posedNames, turnNodeTo } from '../skeleton.js'
import { rotate, turnOnto } from '../../game-maths/turns.js'

/** Solve one orient over the entity's pose. Answers why it could not, or null. */
export default function solveOrient(entity, skeleton, orient) {
  const weight = Math.min(1, Math.max(0, Number(orient.weight) || 0))
  if (weight === 0) return null
  const [name] = posedNames(skeleton, entity.pose, [orient.node]) ?? []
  if (!name) return `orient needs a node the clip poses, got ${JSON.stringify(orient.node)}`
  const [space] = orient.in === undefined ? [null] : (posedNames(skeleton, entity.pose, [orient.in]) ?? [])
  if (orient.in !== undefined && !space) return `orient "in" needs a node the clip poses, got ${JSON.stringify(orient.in)}`
  const spaceTurn = space ? placeOf(skeleton, entity.pose, space).turn : [0, 0, 0, 1]
  const aim = rotate(spaceTurn, orient.aim)
  const upAim = rotate(spaceTurn, orient.upAim)
  turnNodeTo(skeleton, entity.pose, name, turnOnto(orient.forward ?? [0, 0, 1], orient.up ?? [0, 1, 0], aim, upAim), weight)
  return null
}
