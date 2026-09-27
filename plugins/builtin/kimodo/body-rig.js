/**
 * Kimodo designer: a design's body keys as points on the model, so the board
 * draws where the hips, chest and head are asked to be beside where the body
 * is. Body keys are angles and a height (kimodo/poses.js); this turns them
 * into model-space points with the model's own rest pose, the same way
 * motion-conditions.mjs turns them for Kimodo's skeleton.
 */
import { makeCurve } from '../../../engine/curves.js'
import { add, scaled, subtract } from '../game-maths/space.js'
import { blendTurns, fromYawPitchRoll, inverse, multiply, rotate, turnBetween } from '../game-maths/turns.js'
import { placeOf, turnNodeTo } from '../rig-animation/skeleton.js'

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
  const [groundX, groundZ] = valueOf('ground') ?? [rest.hips[0], rest.hips[2]]
  const hips = [groundX, valueOf('height') ?? rest.hips[1], groundZ]
  const [yaw, pitch, roll] = valueOf('torso') ?? [valueOf('heading') ?? 0, 0, 0]
  const torsoTurn = fromYawPitchRoll(pitch, yaw, roll)
  const carried = point => add(hips, rotate(torsoTurn, subtract(point, rest.hips)))
  const head = carried(rest.head)
  const [lookYaw, lookPitch, lookRoll] = valueOf('head') ?? [yaw, pitch, roll]
  const facing = rotate(fromYawPitchRoll(lookPitch, lookYaw, lookRoll), [0, 0, LOOK_LENGTH])
  return { hips, chest: carried(rest.chest), head, look: [head, add(head, facing)] }
}

/**
 * Move the hips node so the hips are at `wanted`, a model-space point whose
 * missing axes (null) stay where the pose has them, by changing its local
 * position in the pose.
 */
function moveHips(skeleton, pose, hips, wanted) {
  const posed = pose[hips]
  if (!posed) return
  const now = placeOf(skeleton, pose, hips).position
  const move = wanted.map((value, axis) => (value === null ? 0 : value - now[axis]))
  const parent = skeleton.nodes[hips].parent
  const parentPlace = parent ? placeOf(skeleton, pose, parent) : { turn: [0, 0, 0, 1], scale: 1 }
  const localMove = scaled(rotate(inverse(parentPlace.turn), move), 1 / parentPlace.scale)
  const position = posed.length === 7 ? posed.slice(4, 7) : skeleton.nodes[hips].position
  pose[hips] = [...posed.slice(0, 4), ...add(position, localMove)]
}

/**
 * Turn the spine nodes between the hips and the chest, each a share, so the
 * line hips to chest points along `direction`.
 */
function bendSpine(skeleton, pose, roles, direction) {
  const spine = []
  for (let name = skeleton.nodes[roles.chest]?.parent; name && name !== roles.hips; name = skeleton.nodes[name].parent)
    spine.unshift(name)
  spine.forEach((name, index) => {
    if (!pose[name]) return
    const hips = placeOf(skeleton, pose, roles.hips).position
    const whole = turnBetween(subtract(placeOf(skeleton, pose, roles.chest).position, hips), direction)
    const share = blendTurns([0, 0, 0, 1], whole, 1 / (spine.length - index))
    turnNodeTo(skeleton, pose, name, multiply(share, placeOf(skeleton, pose, name).turn), 1)
  })
}

/** Turn the head node so the model's front, as the head carries it at rest, points along `direction`. */
function aimHead(skeleton, pose, head, direction) {
  if (!pose[head]) return
  const front = rotate(inverse(placeOf(skeleton, {}, head).turn), [0, 0, 1])
  const place = placeOf(skeleton, pose, head)
  turnNodeTo(skeleton, pose, head, multiply(turnBetween(rotate(place.turn, front), direction), place.turn), 1)
}

/**
 * Pose the body toward the design's body keys at `seconds`, over `pose`,
 * before the hands and feet reach: the hips to the keyed height and ground place, the spine
 * toward the keyed lean, the head toward the keyed look. Only a field a key
 * sets moves the body, so the take's own bounce stays where nothing is keyed.
 * The board's preview of what Kimodo is asked; Kimodo solves the take itself.
 */
export function poseBody(skeleton, pose, design, seconds, rest, roles) {
  const target = bodyTargetAt(design, rest, seconds)
  if (!target) return
  const isKeyed = field => (design.body ?? []).some(key => key[field] !== undefined)
  const hasGround = isKeyed('ground')
  if (isKeyed('height') || hasGround)
    moveHips(skeleton, pose, roles.hips, [hasGround ? target.hips[0] : null, isKeyed('height') ? target.hips[1] : null, hasGround ? target.hips[2] : null])
  if (isKeyed('torso') || isKeyed('heading')) bendSpine(skeleton, pose, roles, subtract(target.chest, target.hips))
  if (isKeyed('head')) aimHead(skeleton, pose, roles.head, subtract(target.look[1], target.look[0]))
}

/** Each foot node's model-space turn under `pose`: `{ node: turn }`, for `feet`, the foot node names. */
export function footTurnsOf(skeleton, pose, feet) {
  return Object.fromEntries(feet.map(foot => [foot, placeOf(skeleton, pose, foot).turn]))
}

/**
 * Give each foot node back the model-space turn in `turns`, after the legs
 * bend: a foot takes its turn from the shin, so a leg bent to a lower pelvis
 * would tip it, and a person standing keeps each foot flat and pointing where
 * it pointed. Kimodo holds a keyed foot's turn from the take the same way.
 */
export function holdFootTurns(skeleton, pose, turns) {
  for (const [foot, turn] of Object.entries(turns)) if (pose[foot]) turnNodeTo(skeleton, pose, foot, turn, 1)
}

/** Where the posed body's hips, chest and head are: `{ hips, chest, head }` in model space, from `roles` (clip-reading.js `rolesOf`). */
export function bodyReachedOf(skeleton, pose, roles) {
  const at = role => placeOf(skeleton, pose, roles[role]).position
  return { hips: at('hips'), chest: at('chest'), head: at('head') }
}

/** The body handles a person drags on the board, each with the point it is drawn at in a body target. The Hips handle is a ring round the pelvis. */
export const BODY_HANDLES = {
  Hips: target => target.hips,
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
 * target at that moment: Hips sets the height and the place over the ground; Chest sets the torso's lean
 * and side lean from the line hips to point, keeping its yaw; Head sets the
 * look from the head toward the point.
 */
export function bodyChangeOf(handle, point, target, key = {}) {
  if (handle === 'Hips') return { height: Number(point[1].toFixed(3)), ground: [point[0], point[2]].map(value => Number(value.toFixed(3))) }
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
