/**
 * Plant: a foot that is down in the clip stays where it touched the world, so
 * it does not slide while the body turns, stops, or moves faster than the
 * clip's stride.
 *
 *   { kind: 'plant', nodes: [upLeg, leg, foot], pole?, lift?: 0.05, still?: 0.5, letGo?: 0.3, blend?: 0.1, weight?: 1 }
 *
 * The foot is down when the clip holds it within `lift` metres of its rest
 * height and the clip itself moves it slower than `still` metres a second (the
 * foot plus the clip's root travel, `entity.rigRoot`): a low foot the clip
 * still slides, as a fast run's does, is left to the clip, since locking it
 * and letting go makes the foot jump. It is then locked at that world point and the leg bends to it, until
 * the clip lifts it; then it lets go over `blend` seconds and the clip's foot
 * takes over. A lock more than `letGo` metres from where the clip puts the
 * foot lets go the same way. A foot is planted again only once it has faded
 * back to the clip, where it already is: it never jumps to a new spot.
 * The foot keeps the turn the clip gives it, so it stays flat. `pole`, any
 * target shape, is where the knee points; left out, it keeps the clip's bend.
 *
 * Declared once on the type as `rig.constraints`, for every foot of the model.
 */
import { placeOf, posedNames, turnNodeTo } from '../skeleton.js'
import { modelPointOf, pointOf, worldPointOf } from '../targets.js'
import { lengthOf, subtract } from '../../game-maths/space.js'
import { bendChain } from './reach.js'

/**
 * Solve one plant over the entity's pose. `memory` is kept between steps for
 * this constraint: `{ lock, held, weight, restHeight, lastFoot }`. Answers why it could not, or null.
 */
export default function solvePlant(entity, skeleton, plant, { seconds, memory }) {
  const chain = posedNames(skeleton, entity.pose, plant.nodes)
  if (chain?.length !== 3) return `plant needs three nodes the clip poses, got ${JSON.stringify(plant.nodes)}`
  const end = chain[2]
  const foot = placeOf(skeleton, entity.pose, end)
  memory.restHeight ??= placeOf(skeleton, {}, end).position[1]
  const clipSpeed = clipFootSpeed(entity, memory, foot.position, seconds)
  const isDown = foot.position[1] <= memory.restHeight + (plant.lift ?? 0.05) && clipSpeed < (plant.still ?? 0.5)
  memory.lock = nextLock(entity, memory, foot.position, isDown, plant.letGo ?? 0.3)
  if (memory.lock) memory.held = memory.lock
  memory.weight = eased(memory.weight ?? 0, memory.lock ? 1 : 0, seconds, plant.blend ?? 0.1)
  const weight = memory.weight * (plant.weight ?? 1)
  if (!memory.held || weight <= 0) return null
  const pole = plant.pole ? pointOf(entity, skeleton, plant.pole) : null
  bendChain(skeleton, entity.pose, chain, modelPointOf(entity, memory.held), pole, weight)
  turnNodeTo(skeleton, entity.pose, end, foot.turn, weight)
  return null
}

/**
 * How fast the clip moves the foot, in metres a second: its place plus the
 * clip's root travel, so a foot the clip holds still reads 0 whatever the body
 * does. A step where the root jumps back (a loop starting again) reads 0.
 */
function clipFootSpeed(entity, memory, footAt, seconds) {
  const root = entity.rigRoot ?? [0, 0, 0]
  const inClip = [footAt[0] + root[0], footAt[1], footAt[2] + root[2]]
  const last = memory.lastFoot
  memory.lastFoot = inClip
  if (!last || seconds <= 0) return 0
  const moved = lengthOf(subtract(inClip, last))
  return moved > 1 ? 0 : moved / seconds
}

/** The world point the foot is locked to this step, or null when it is free. */
function nextLock(entity, memory, footAt, isDown, letGo) {
  if (!isDown) return null
  // Still fading out from the last lock: planting now would jump.
  if (!memory.lock) return memory.weight > 0 ? null : worldPointOf(entity, footAt)
  const isLeftBehind = lengthOf(subtract(modelPointOf(entity, memory.lock), footAt)) > letGo
  return isLeftBehind ? null : memory.lock
}

/** `value` moved towards `goal` at a rate that covers 0 to 1 in `blend` seconds; at once when `blend` is 0. */
function eased(value, goal, seconds, blend) {
  if (blend <= 0) return goal
  const most = seconds / blend
  return value + Math.max(-most, Math.min(most, goal - value))
}
