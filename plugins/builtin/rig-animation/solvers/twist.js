/**
 * Twist: turn a chain of nodes by one turn shared along it — the spine turned
 * and leaned after a swung item, each bone taking an even part.
 *
 *   { kind: 'twist', nodes: [low, ..., high], turn: [x, y, z, w], weight }
 *
 * `turn` is in model space and is the whole turn the top node ends with; the
 * nodes are listed from the lowest up. `weight` blends from the pose, 0 to 1.
 * Solve it before a reach, so the hands still reach their targets on the
 * turned body.
 */
import { placeOf, posedNames, turnNodeTo } from '../skeleton.js'
import { blendTurns, multiply } from '../../game-maths/turns.js'

/** Solve one twist over the entity's pose. Answers why it could not, or null. */
export default function solveTwist(entity, skeleton, twist) {
  const weight = Math.min(1, Math.max(0, Number(twist.weight) || 0))
  if (weight === 0) return null
  const names = posedNames(skeleton, entity.pose, twist.nodes)
  if (!names) return `twist needs nodes the clip poses, got ${JSON.stringify(twist.nodes)}`
  // Each node turns by its share; a child also carries its parents' shares, so the top node ends with the whole turn.
  const share = blendTurns([0, 0, 0, 1], twist.turn, weight / names.length)
  for (const name of names) turnNodeTo(skeleton, entity.pose, name, multiply(share, placeOf(skeleton, entity.pose, name).turn), 1)
  return null
}
