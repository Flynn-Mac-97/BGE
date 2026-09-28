/**
 * Wrist: keep a hand's turn on its forearm to what a wrist can do — a hand
 * turned onto a sword's grip, kept from folding back or wringing round.
 *
 *   { kind: 'wrist', node, bend: 65, twist: 70, share: 0.5, weight }
 *
 * The hand's turn from its rest, in the forearm's space, is taken as a twist
 * about the forearm and a bend off it. `share` of the twist moves into the
 * forearm, as a forearm rolls to turn the palm over, and the hand keeps its
 * place in the world. What twist is left is held to `twist` degrees and the
 * bend to `bend` degrees; past them the hand, and whatever it holds, turns
 * no further. Solve it after the hand's own orient. `weight` blends from the
 * pose, 0 to 1.
 */
import { posedNames } from '../skeleton.js'
import { blendTurns, inverse, multiply } from '../../game-maths/turns.js'
import { dot, scaled, unit } from '../../game-maths/space.js'

const DEGREES = Math.PI / 180

/** A turn of `angle` radians about the unit `axis`. */
const turnAboutAxis = (axis, angle) => [...scaled(axis, Math.sin(angle / 2)), Math.cos(angle / 2)]

/** An angle brought into -π to π. */
const wrapped = angle => Math.atan2(Math.sin(angle), Math.cos(angle))

/** Solve one wrist over the entity's pose. Answers why it could not, or null. */
export default function solveWrist(entity, skeleton, wrist, { memory = {} } = {}) {
  const weight = Math.min(1, Math.max(0, Number(wrist.weight) || 0))
  if (weight === 0) return null
  const [name] = posedNames(skeleton, entity.pose, [wrist.node]) ?? []
  const forearm = name && skeleton.nodes[name].parent
  if (!name || !entity.pose[forearm]) return `wrist needs a hand the clip poses, and its forearm, got ${JSON.stringify(wrist.node)}`
  const { position, rotation: rest } = skeleton.nodes[name]
  const axis = unit(position)
  const hand = entity.pose[name]
  const local = hand.slice(0, 4)

  const twistOf = turn => wrapped(2 * Math.atan2(dot(turn.slice(0, 3), axis), turn[3]))
  const deviation = multiply(local, inverse(rest))
  // The twist is read on from the last step's, not wrapped to ±180°: a hand turning past 180° would
  // otherwise flip the forearm's share from one side to the other in one step.
  const wrappedTwist = twistOf(deviation)
  const twist = memory.twist === undefined ? wrappedTwist : memory.twist + wrapped(wrappedTwist - memory.twist)
  memory.twist = twist
  // The forearm rolls by its share about its own length; the hand turns back as much, so it stays where it was.
  const rollAngle = twist * (wrist.share ?? 0.5) * weight
  const roll = turnAboutAxis(axis, rollAngle)
  const forearmTurn = multiply(entity.pose[forearm].slice(0, 4), roll)
  const left = multiply(inverse(roll), deviation)
  // A turn about the same axis shifts the twist by exactly its angle, so what is left needs no new wrap.
  const leftTwist = twist - rollAngle
  const heldTwist = Math.max(-(wrist.twist ?? 70) * DEGREES, Math.min((wrist.twist ?? 70) * DEGREES, leftTwist))
  const swing = multiply(left, inverse(turnAboutAxis(axis, leftTwist)))
  const bend = 2 * Math.acos(Math.min(1, Math.abs(swing[3])))
  const limit = (wrist.bend ?? 65) * DEGREES
  const heldSwing = bend > limit ? blendTurns([0, 0, 0, 1], swing, limit / bend) : swing
  const heldLocal = blendTurns(multiply(inverse(roll), local), multiply(multiply(heldSwing, turnAboutAxis(axis, heldTwist)), rest), weight)

  for (let index = 0; index < 4; index++) {
    entity.pose[forearm][index] = forearmTurn[index]
    hand[index] = heldLocal[index]
  }
  return null
}
