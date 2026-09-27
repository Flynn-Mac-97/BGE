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

/** How far behind the pelvis the Hips handle is drawn, in metres, so a hand keyed on the hip does not cover it. */
const HIPS_HANDLE_BEHIND = 0.15

/** The body handles a person drags on the board, each with the point it is drawn at in a body target. */
export const BODY_HANDLES = {
  Hips: target => add(target.hips, [0, 0, -HIPS_HANDLE_BEHIND]),
  Chest: target => target.chest,
  Head: target => target.look[1]
}

/** Where each body handle is drawn at `seconds`: at the body keys, or at rest before the design has any. */
export function bodyHandlePoints(design, rest, seconds) {
  const body = design.body?.length ? design.body : [{ at: 0 }]
  const target = bodyTargetAt({ body }, rest, seconds)
  return Object.fromEntries(Object.entries(BODY_HANDLES).map(([handle, pointIn]) => [handle, pointIn(target)]))
}

/**
 * The body key change a body handle dropped at `point` asks for, given the
 * target at that moment: Hips sets the height; Chest sets the torso's lean
 * and side lean from the line hips to point, keeping its yaw; Head sets the
 * look from the head toward the point.
 */
export function bodyChangeOf(handle, point, target, key = {}) {
  if (handle === 'Hips') return { height: Number(point[1].toFixed(3)) }
  if (handle === 'Chest') {
    const yaw = key.torso?.[0] ?? key.heading ?? 0
    const line = rotate(fromYawPitchRoll(0, -yaw, 0), subtract(point, target.hips))
    const length = Math.hypot(...line) || 1
    const torso = [yaw, Math.atan2(line[2], line[1]), -Math.asin(line[0] / length)]
    return { torso: torso.map(angle => Number(angle.toFixed(3))) }
  }
  const look = subtract(point, target.head)
  const head = [Math.atan2(look[0], look[2]), Math.atan2(-look[1], Math.hypot(look[0], look[2])), 0]
  return { head: head.map(angle => Number(angle.toFixed(3))) }
}

/** `design` with the body key at `seconds` changed by `change`, or a new key there. */
export function withBodyKey(design, seconds, change) {
  const at = Math.round(seconds * 30) / 30
  const body = design.body ?? []
  const old = body.find(key => Math.abs(key.at - at) < 1e-6)
  const others = body.filter(key => key !== old)
  const keys = [...others, { ...old, at, ...change }].sort((first, second) => first.at - second.at)
  return { ...design, body: keys }
}

/** `design` without `field` of its body key at `at`; a key left with nothing set is dropped. */
export function withoutBodyField(design, at, field) {
  const body = (design.body ?? [])
    .map(key => (key.at === at ? Object.fromEntries(Object.entries(key).filter(([name]) => name !== field)) : key))
    .filter(key => Object.keys(key).length > 1)
  return { ...design, body }
}
