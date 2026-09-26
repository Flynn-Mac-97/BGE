/**
 * Plant: a foot that is down in the clip stays where it touched the world, so
 * it does not slide while the body turns, stops, or moves faster than the
 * clip's stride.
 *
 *   { kind: 'plant', nodes: [upLeg, leg, foot], lift?: 0.05, letGo?: 0.3, blend?: 0.1, weight?: 1 }
 *
 * The foot is down when the clip holds it within `lift` metres of its rest
 * height. It is then locked at that world point and the leg bends to it, until
 * the clip lifts it; then it lets go over `blend` seconds and the clip's foot
 * takes over. A lock more than `letGo` metres from where the clip puts the
 * foot lets go the same way. A foot is planted again only once it has faded
 * back to the clip, where it already is: it never jumps to a new spot.
 * The foot keeps the turn the clip gives it, so it stays flat.
 *
 * Declared once on the type as `rig.constraints`, for every foot of the model.
 */
import { placeOf, posedNames, turnNodeTo } from '../skeleton.js'
import { modelPointOf, worldPointOf } from '../targets.js'
import { lengthOf, subtract } from '../turns.js'
import { bendChain } from './reach.js'

/**
 * Solve one plant over the entity's pose. `memory` is kept between steps for
 * this constraint: `{ lock, held, weight, restHeight }`. Answers why it could not, or null.
 */
export default function solvePlant(entity, skeleton, plant, { seconds, memory }) {
  const chain = posedNames(skeleton, entity.pose, plant.nodes)
  if (chain?.length !== 3) return `plant needs three nodes the clip poses, got ${JSON.stringify(plant.nodes)}`
  const end = chain[2]
  const foot = placeOf(skeleton, entity.pose, end)
  memory.restHeight ??= placeOf(skeleton, {}, end).position[1]
  const isDown = foot.position[1] <= memory.restHeight + (plant.lift ?? 0.05)
  memory.lock = nextLock(entity, memory, foot.position, isDown, plant.letGo ?? 0.3)
  if (memory.lock) memory.held = memory.lock
  memory.weight = eased(memory.weight ?? 0, memory.lock ? 1 : 0, seconds, plant.blend ?? 0.1)
  const weight = memory.weight * (plant.weight ?? 1)
  if (!memory.held || weight <= 0) return null
  bendChain(skeleton, entity.pose, chain, modelPointOf(entity, memory.held), null, weight)
  turnNodeTo(skeleton, entity.pose, end, foot.turn, weight)
  return null
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
