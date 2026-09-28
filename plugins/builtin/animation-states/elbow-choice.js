/**
 * Animation States: where an elbow goes when its hand grips an item. A hand
 * at a place with a turn leaves the elbow free on a circle about the line from
 * the shoulder to the hand; a person picks the point where the wrist is
 * easiest, the elbow is down, and the arm is clear of the chest. This tries
 * ELBOW_TRIES points on that circle and answers the cheapest, as the pole a
 * reach bends toward. Pure.
 *
 * The cost of an elbow point, each term in metres or radians squared:
 *   - the wrist's bend past COMFORT: the angle between the forearm and the
 *     way the hand points on the grip with a straight wrist;
 *   - the elbow above the hand, or above the shoulder;
 *   - the elbow inside the chest;
 *   - a change from the angle chosen last step, so the elbow does not flip.
 */
import { dot, lengthOf, scaled, subtract, add, unit, cross } from '../game-maths/space.js'
import { inverse, multiply, rotate } from '../game-maths/turns.js'

/** How many points on the circle are tried. */
const ELBOW_TRIES = 16

/** A wrist bend a grip holds with ease, in radians: a sword's hand cocks this far without strain. */
const COMFORT = 0.45

/** Each cost's weight: the wrist, the elbow above the hand, above the shoulder, in the chest, and a change of angle. */
const WEIGHTS = { wrist: 1, overHand: 60, overShoulder: 15, inChest: 200, change: 0.15 }

/** The chest as a box about the chest node, in its space, metres: half its width, half its depth and its middle's depth. */
const CHEST_BOX = { halfWidth: 0.2, halfDepth: 0.14, middle: 0.03 }

/** How far a point is inside the chest box, 0 when outside. */
function depthInChest(point, chest) {
  const [x, , z] = rotate(inverse(chest.turn), subtract(point, chest.position))
  return Math.max(0, Math.min(CHEST_BOX.halfWidth - Math.abs(x), CHEST_BOX.halfDepth - Math.abs(z - CHEST_BOX.middle)))
}

/** The smallest turn between two angles, in radians. */
const angleBetween = (first, second) => Math.atan2(Math.sin(first - second), Math.cos(first - second))

/**
 * The elbow point for a hand at `hand` turned `handTurn` in model space, the
 * arm's nodes `[upper, lower, end]` in `skeleton`, from `shoulder`. `memory`
 * keeps the angle chosen, one record per arm, so the choice is smooth.
 */
export function chosenElbow({ skeleton, nodes, shoulder, hand, handTurn, chest, memory }) {
  const upper = lengthOf(skeleton.nodes[nodes[1]].position)
  const lower = lengthOf(skeleton.nodes[nodes[2]].position)
  const { position: handOffset, rotation: handRest } = skeleton.nodes[nodes[2]]
  // The way the forearm runs when the wrist is straight on this grip.
  const straight = unit(rotate(multiply(handTurn, inverse(handRest)), handOffset))
  const reach = subtract(hand, shoulder)
  const span = Math.min(lengthOf(reach), upper + lower - 1e-4)
  const along = unit(reach)
  const fromShoulder = (upper * upper - lower * lower + span * span) / (2 * span)
  const radius = Math.sqrt(Math.max(0, upper * upper - fromShoulder * fromShoulder))
  const down = subtract([0, -1, 0], scaled(along, -along[1]))
  const first = lengthOf(down) > 1e-3 ? unit(down) : unit(cross(along, [1, 0, 0]))
  const second = cross(along, first)
  const centre = add(shoulder, scaled(along, fromShoulder))

  const costOf = angle => {
    const elbow = add(centre, scaled(add(scaled(first, Math.cos(angle)), scaled(second, Math.sin(angle))), radius))
    const bend = Math.acos(Math.max(-1, Math.min(1, dot(unit(subtract(hand, elbow)), straight))))
    const wrist = Math.max(0, bend - COMFORT) ** 2
    const overHand = Math.max(0, elbow[1] - hand[1]) ** 2
    const overShoulder = Math.max(0, elbow[1] - shoulder[1]) ** 2
    const change = memory.angle === undefined ? 0 : angleBetween(angle, memory.angle) ** 2
    // The upper arm and the forearm, not only the elbow, must clear the chest.
    const inChest = [0.5, 0.75, 1].map(share => depthInChest(add(shoulder, scaled(subtract(elbow, shoulder), share)), chest))
    const forearmIn = depthInChest(scaled(add(elbow, hand), 0.5), chest)
    const clash = Math.max(...inChest, forearmIn)
    const cost = WEIGHTS.wrist * wrist + WEIGHTS.overHand * overHand + WEIGHTS.overShoulder * overShoulder + WEIGHTS.inChest * clash ** 2 + WEIGHTS.change * change
    return { angle, elbow, cost }
  }
  const tries = Array.from({ length: ELBOW_TRIES }, (_, index) => costOf((index / ELBOW_TRIES) * 2 * Math.PI - Math.PI))
  const best = tries.reduce((cheapest, tried) => (tried.cost < cheapest.cost ? tried : cheapest))
  memory.angle = best.angle
  return best.elbow
}
