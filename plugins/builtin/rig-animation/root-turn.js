/**
 * Rig Animation: root turn. While `entity.rigRootTurn` is true, the clip's
 * turn of its root node about the up axis is moved into `entity.yaw`, step by
 * step, and taken off the root, so the body looks the same while its facing
 * follows the clip. When the clip ends the entity keeps the facing it turned
 * to, and the next clip starts square to it: a turn in place.
 *
 * Meant for a clip that plays once. A loop's jump from its last frame to its
 * first would turn the entity back.
 *
 * The turn taken so far is kept in `entity._rigTurnTaken` (radians), and the
 * root's heading last step in `entity._rigTurnLast`; both are cleared when the
 * base clip changes, and the crossfade takes the same turn off the clip left
 * behind (crossfade.js).
 */
import { multiply, rotate, turnAbout } from '../game-maths/turns.js'

/** An angle wrapped into -pi..pi. */
const wrapped = angle => Math.atan2(Math.sin(angle), Math.cos(angle))

/** The heading of a turn: the angle about +Y from +Z to where it points +Z. */
function headingOf(turn) {
  const forward = rotate(turn, [0, 0, 1])
  return Math.atan2(forward[0], forward[2])
}

/** The turn that takes the root's turn so far back off a pose's root, or null when there is none. */
export const rootTurnBack = entity => (entity._rigTurnTaken ? turnAbout(1, -entity._rigTurnTaken) : null)

/** Forget the turn taken, when the base clip changes. */
export function resetRootTurn(entity) {
  entity._rigTurnTaken = 0
  entity._rigTurnLast = null
}

/** Move this step's turn of the clip's root into `entity.yaw`, and take the whole turn so far off the root. */
export function applyRootTurn(entity, clip) {
  const root = clip.nodes[0]
  const posed = entity.pose?.[root]
  if (!posed) return
  const heading = headingOf(posed.slice(0, 4))
  const step = entity._rigTurnLast === null || entity._rigTurnLast === undefined ? 0 : wrapped(heading - entity._rigTurnLast)
  entity._rigTurnLast = heading
  entity._rigTurnTaken = (entity._rigTurnTaken ?? 0) + step
  entity.yaw = (Number.isFinite(entity.yaw) ? entity.yaw : 0) + step
  const back = rootTurnBack(entity)
  if (!back) return
  const turned = multiply(back, posed.slice(0, 4))
  for (let axis = 0; axis < 4; axis++) posed[axis] = turned[axis]
  // A root that also moves is moved about the model's origin by the same turn.
  if (posed.length < 7) return
  const moved = rotate(back, posed.slice(4, 7))
  for (let axis = 0; axis < 3; axis++) posed[4 + axis] = moved[axis]
}
