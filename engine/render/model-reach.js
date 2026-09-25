/**
 * Kernel: a limb of a posed model reaching for a point, drawn after the pose.
 *
 * `entity.rigReach` bends a chain of three named nodes — upper, lower and end,
 * such as an arm, a forearm and a hand — so the end touches a target:
 *
 *   entity.rigReach = {
 *     nodes: ['mixamorig:RightArm', 'mixamorig:RightForeArm', 'mixamorig:RightHand'],
 *     target: { attachment: 'sword-1' },   // its origin, or { attachment, at: [x, y, z] } in its space,
 *                                          // or { node, at: [x, y, z] } in that node's space,
 *                                          // or { point: [x, y, z] } in the world
 *     weight: 0.6,                         // 0 is the pose as it was, 1 is touching
 *     pole: { point: [x, y, z] }           // optional, any target shape: the side the joint bends to
 *   }
 *
 * It is two-bone inverse kinematics: the upper node turns so the joint lands
 * where both lengths meet the target, then the lower turns the end onto it.
 * The limb keeps the side its joint already bends to, so an elbow does not
 * flip, unless a `pole` names the side: an archer's elbow up and back. A target past the limb's length is reached towards, straight-armed.
 *
 * A list of such records bends several chains, one after another — both arms
 * holding a bow.
 *
 * It only draws. Game code owns the weight over time, so a reach is the same
 * data headless as on screen; nothing here writes back to the entity.
 */
import * as THREE from 'three/webgpu'
import { attachedModels, namedNodes, nodeNamed } from './model-nodes.js'
import { reportOnce } from './report.js'

/** How far short of its full length a limb stops, so it never locks straight. */
const LONGEST = 0.999

// Scratch values, made once: a reach runs every drawn frame.
const [upperAt, lowerAt, endAt, targetAt, poleAt, direction, side, jointAt, directionNow, directionWanted] = Array.from(
  { length: 10 },
  () => new THREE.Vector3()
)
const [turn, worldTurn, parentTurn, solved] = Array.from({ length: 4 }, () => new THREE.Quaternion())

/** Bend the named chain of `holder` towards `reach.target`, by `reach.weight`; or each of a list in turn. */
export function applyReach(holder, reach) {
  for (const one of [].concat(reach)) reachWithOne(holder, one)
}

function reachWithOne(holder, reach) {
  const weight = Math.min(1, Math.max(0, Number(reach?.weight) || 0))
  const nodes = namedNodes.get(holder)
  // No weight, or still loading: nothing to bend this frame.
  if (weight === 0 || !nodes) return
  const chain = chainOf(nodes, reach.nodes)
  if (!chain) return
  holder.updateMatrixWorld(true)
  if (!targetOf(holder, nodes, reach.target, targetAt)) return
  const pole = reach.pole && targetOf(holder, nodes, reach.pole, poleAt) ? poleAt : null
  solve(chain, weight, pole)
}

/** The three nodes a reach names, or null, said once, when the model has not got them. */
function chainOf(nodes, names) {
  const chain = (names ?? []).map(name => nodeNamed(nodes, name))
  if (chain.length === 3 && chain.every(Boolean)) return chain
  reportOnce(`[render] rigReach: needs three nodes this model has, got ${JSON.stringify(names)}`)
  return null
}

/** Bend upper and lower so the end meets `targetAt`, blended by `weight`; the joint towards `pole` when there is one. */
function solve([upper, lower, end], weight, pole) {
  upper.getWorldPosition(upperAt)
  lower.getWorldPosition(lowerAt)
  end.getWorldPosition(endAt)
  placeJoint(upperAt, lowerAt, endAt, pole, jointAt)
  turnTowards(upper, lowerAt, jointAt, upperAt, weight)
  lower.getWorldPosition(lowerAt)
  end.getWorldPosition(endAt)
  turnTowards(lower, endAt, targetAt, lowerAt, weight)
}

/** Where the target is in the world, into `into`. False when there is none yet. */
function targetOf(holder, nodes, target, into) {
  if (target?.node) {
    const node = nodeNamed(nodes, target.node)
    return Boolean(node) && placedIn(node, target.at, into)
  }
  if (Array.isArray(target?.point)) {
    into.set(target.point[0], target.point[1], target.point[2])
    return true
  }
  const entry = attachedModels.get(holder)?.get(target?.attachment)
  // An attachment that has not been hung yet is reached for on a later frame.
  return Boolean(entry) && placedIn(entry.group, target.at, into)
}

/** The world point at `local` (the origin when absent) in `object`'s space, into `into`. */
function placedIn(object, local = [0, 0, 0], into) {
  object.localToWorld(into.set(local[0], local[1], local[2]))
  return true
}

/** Where the middle joint goes: both lengths kept, on the side of `pole`, or else the side it bends to now. */
function placeJoint(upper, lower, end, pole, into) {
  const upperLength = upper.distanceTo(lower)
  const lowerLength = lower.distanceTo(end)
  direction.subVectors(targetAt, upper)
  const distance = Math.min(Math.max(direction.length(), 1e-4), (upperLength + lowerLength) * LONGEST)
  direction.normalize()
  // The joint's offset from the straight line, which is the side it bends to.
  side.subVectors(pole ?? lower, upper)
  side.addScaledVector(direction, -side.dot(direction))
  if (side.lengthSq() < 1e-8) side.set(0, -1, 0).addScaledVector(direction, -direction.y)
  side.normalize()
  const cosine = (upperLength ** 2 + distance ** 2 - lowerLength ** 2) / (2 * upperLength * distance)
  const angle = Math.acos(Math.min(1, Math.max(-1, cosine)))
  into
    .copy(upper)
    .addScaledVector(direction, Math.cos(angle) * upperLength)
    .addScaledVector(side, Math.sin(angle) * upperLength)
}

/**
 * Turn `node` in the world so the point now at `now` moves to `wanted`, about
 * `pivot`, blended by `weight` from its posed turn.
 */
function turnTowards(node, now, wanted, pivot, weight) {
  directionNow.subVectors(now, pivot).normalize()
  directionWanted.subVectors(wanted, pivot).normalize()
  turn.setFromUnitVectors(directionNow, directionWanted)
  node.getWorldQuaternion(worldTurn)
  worldTurn.premultiply(turn)
  node.parent.getWorldQuaternion(parentTurn).invert()
  // Into its own quaternion: slerp copies its first argument over the target first.
  solved.copy(parentTurn.multiply(worldTurn))
  node.quaternion.slerp(solved, weight)
  node.updateMatrix()
  node.updateMatrixWorld(true)
}
