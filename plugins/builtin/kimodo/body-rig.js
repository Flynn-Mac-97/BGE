/**
 * Kimodo designer: a design's body keys as points on the model, so the board
 * draws where the hips, chest and head are asked to be beside where the body
 * is. Body keys are angles and a height (kimodo/poses.js); this turns them
 * into model-space points with the model's own rest pose, the same way
 * motion-conditions.mjs turns them for Kimodo's skeleton.
 */
import { makeCurve } from '../../../engine/curves.js'
import { add, subtract } from '../game-maths/space.js'
import { fromYawPitchRoll, rotate } from '../game-maths/turns.js'
import { placeOf } from '../rig-animation/skeleton.js'

/** How far the look arrow reaches from the head, in metres. */
const LOOK_LENGTH = 0.3

/** One field of the body keys that set it, as a curve; null when no key sets it. */
function curveOf(body, field) {
  const keys = body.filter(key => key[field] !== undefined).map(key => ({ at: key.at, value: key[field] }))
  return keys.length ? makeCurve(keys) : null
}

/**
 * Where the design's body keys ask the hips, chest and head to be at
 * `seconds`, and the head's look as a line: `{ hips, chest, head, look: [from,
 * to] }`, model-space points, or null when the design has no body keys. A
 * field no key sets stays at rest.
 */
export function bodyTargetAt(design, rest, seconds) {
  const body = design.body ?? []
  if (!body.length) return null
  const valueOf = field => curveOf(body, field)?.valueAt(seconds)
  const hips = [rest.hips[0], valueOf('height') ?? rest.hips[1], rest.hips[2]]
  const [yaw, pitch, roll] = valueOf('torso') ?? [valueOf('heading') ?? 0, 0, 0]
  const torsoTurn = fromYawPitchRoll(pitch, yaw, roll)
  const carried = point => add(hips, rotate(torsoTurn, subtract(point, rest.hips)))
  const head = carried(rest.head)
  const [lookYaw, lookPitch, lookRoll] = valueOf('head') ?? [yaw, pitch, roll]
  const facing = rotate(fromYawPitchRoll(lookPitch, lookYaw, lookRoll), [0, 0, LOOK_LENGTH])
  return { hips, chest: carried(rest.chest), head, look: [head, add(head, facing)] }
}

/** Where the posed body's hips, chest and head are: `{ hips, chest, head }` in model space, from `roles` (clip-reading.js `rolesOf`). */
export function bodyReachedOf(skeleton, pose, roles) {
  const at = role => placeOf(skeleton, pose, roles[role]).position
  return { hips: at('hips'), chest: at('chest'), head: at('head') }
}
