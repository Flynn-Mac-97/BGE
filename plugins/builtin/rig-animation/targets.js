/**
 * Rig Animation: where a constraint's target is, in model space, and turning
 * points between model space and the world.
 *
 * A target is a point, in one of four shapes:
 *   { node, at? }        a point in that node's own space, its origin when `at` is left out
 *   { attachment, at? }  a point in that attachment's model space, where it hangs now
 *   { model }            a point in model space: it turns with the entity, not with a bone
 *   { point }            a point in the world
 *
 * Model space is the model file's space; the entity's place, turn and scale
 * take it into the world, as the renderer draws it.
 */
import { anchorOffset, totalScale, turnRadians } from '../../../engine/frame-plan.js'
import { pointIn } from './skeleton.js'
import { add, fromYawPitchRoll, inverse, rotate, scaled, subtract } from './turns.js'

/** Where a target is in model space, or null when it is not there yet. */
export function pointOf(entity, skeleton, target) {
  const shape = ['node', 'attachment', 'model', 'point'].find(key => target?.[key] !== undefined)
  return shape ? TARGETS[shape](entity, skeleton, target) : null
}

/** A world point in the entity's model space. */
export function modelPointOf(entity, point) {
  const { origin, turn, scale } = placeOfEntity(entity)
  return scaled(rotate(inverse(turn), subtract(point, origin)), 1 / scale)
}

/** A model-space point of the entity in the world. */
export function worldPointOf(entity, point) {
  const { origin, turn, scale } = placeOfEntity(entity)
  return add(origin, rotate(turn, scaled(point, scale)))
}

/** The entity's origin, turn and scale, as the renderer places its model. */
function placeOfEntity(entity) {
  const turn = turnRadians(entity)
  return {
    origin: [entity.x ?? 0, (entity.y ?? 0) + anchorOffset(entity), entity.z ?? 0],
    turn: fromYawPitchRoll(turn.x, turn.y, turn.z),
    scale: totalScale(entity)
  }
}

const TARGETS = {
  node(entity, skeleton, target) {
    const name = skeleton.nameOf(target.node)
    return name ? pointIn(skeleton, entity.pose, name, target.at ?? [0, 0, 0]) : null
  },
  attachment(entity, skeleton, target) {
    const hung = entity.attachments?.[target.attachment]
    const name = hung && skeleton.nameOf(hung.node)
    if (!name) return null
    // An attachment is placed in its node's space as the renderer places it: turned YXZ, then scaled.
    const [x, y, z] = vectorOf(hung.rotation)
    const local = rotate(fromYawPitchRoll(x, y, z), scaled(target.at ?? [0, 0, 0], hung.scale ?? 1))
    return pointIn(skeleton, entity.pose, name, add(vectorOf(hung.position), local))
  },
  model: (entity, skeleton, target) => target.model,
  point: (entity, skeleton, target) => modelPointOf(entity, target.point)
}

/** A vector as `[x, y, z]`, from either an array or `{ x, y, z }`; zero when left out. */
const vectorOf = value => (Array.isArray(value) ? value : [value?.x ?? 0, value?.y ?? 0, value?.z ?? 0])
