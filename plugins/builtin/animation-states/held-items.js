/**
 * Animation States: an item held over whatever the body plays, as the
 * constraints that hold it and where the item hangs. Pure: it reads a pose and
 * a hold record and answers constraints; the caller solves them.
 *
 * An item is held one of two ways, by its grip:
 *   - by sockets: the item is placed and aimed first (the holding hand's socket
 *     at the guard point in front of the chest, the item pointing by the
 *     guard's pitch, yaw and roll in the chest's space), then each hand on it
 *     is locked to its socket, place and turn, by a reach and an orient.
 *   - by a mount: the item rides one bone, a shield strapped along the forearm;
 *     a reach puts the hand at the guard point and the elbow toward `elbow`.
 * A spring makes the hand lag the body, and a sway moves it a little.
 *
 * A hold record is one file, `<item>.hold.json`, beside the item's model:
 *   {
 *     model: 'models/items/sword.glb',
 *     hand: 'right' | 'left',            the hand the guard places
 *     points: { axis, upAxis, up },      sockets only: the item's axis that points, and its
 *                                        axis turned 'outward' from the body or 'up'
 *     grip: { sockets: { right: { position, turn }, left?: ... } }
 *         | { mount: { on: 'forearm' | 'hand', position, turn } },
 *                                        a socket is where the hand bone goes and its turn, in
 *                                        the item's space; a mount is where the item's origin
 *                                        goes and its turn, in the bone's space
 *     elbow?: [x, y, z],                 where each elbow bends toward, in the chest's space,
 *                                        for the holding side; the other side is mirrored
 *     guard: { distance, height, side, pitch, yaw, roll },   metres from the chest, degrees
 *     motion: { stiffness, damping, sway, swaySpeed },       the spring (0 stiffness: none)
 *     weight: 1                          0 leaves the clip's hands, 1 holds fully
 *   }
 * Socket and mount numbers fit the rig they were set on; each rig's hands
 * differ, so an item set on one rig needs its grip set again on another.
 */
import { placeOf } from '../rig-animation/skeleton.js'
import { rolesOf } from '../rig-animation/clip-reading.js'
import { add, scaled, subtract, unit } from '../game-maths/space.js'
import { inverse, multiply, rotate, turnOnto } from '../game-maths/turns.js'

const DEGREES = Math.PI / 180

/** The longest step the spring takes; a longer gap (a pause, a loop's wrap) is taken as one frame. */
const LONGEST_STEP = 0.1

/** Where an elbow bends toward when the record names none: down, out and back from the chest. */
const ELBOW_OUT = [0.45, -0.3, -0.3]

/** Which way is out from the body along X for each side: the model's right is -X. */
const OUTWARD = { right: -1, left: 1 }

/** The other hand. */
const OTHER = { right: 'left', left: 'right' }

/** The elbow target for `side`: the record's, mirrored for the other side. */
const elbowOf = (record, side) => {
  const [x, y, z] = record.elbow ?? ELBOW_OUT
  return [Math.abs(x) * OUTWARD[side], y, z]
}

/**
 * The item's turn in model space: its axis along the guard's pitch and yaw,
 * its up axis toward the body's outside or up, rolled about the way it
 * points, all in the chest's space.
 */
function itemTurnOf(record, chestTurn) {
  const { pitch = 0, yaw = 0, roll = 0 } = record.guard
  const [pitchAngle, yawAngle, rollAngle] = [pitch * DEGREES, yaw * DEGREES, roll * DEGREES]
  const pointing = [Math.sin(yawAngle) * Math.cos(pitchAngle), Math.sin(pitchAngle), Math.cos(yawAngle) * Math.cos(pitchAngle)]
  const upward = record.points.up === 'up' ? [0, 1, 0] : [OUTWARD[record.hand], 0, 0]
  const rolled = rotate([...scaled(unit(pointing), Math.sin(rollAngle / 2)), Math.cos(rollAngle / 2)], upward)
  return turnOnto(record.points.axis, record.points.upAxis, rotate(chestTurn, pointing), rotate(chestTurn, rolled))
}

/** Where the holding hand is asked to be, in model space, before the spring. */
function guardPoint(record, chest, seconds) {
  const { distance = 0.3, height = 0, side = 0.2 } = record.guard
  const { sway = 0, swaySpeed = 0 } = record.motion ?? {}
  const phase = seconds * swaySpeed * 2 * Math.PI
  const drift = [Math.sin(phase) * sway, Math.sin(phase * 2) * sway * 0.5, 0]
  return add(add(chest, [OUTWARD[record.hand] * side, height, distance]), drift)
}

/** The point after the spring, stepped from the last step's, kept in `memory`. */
function sprungPoint(record, wanted, seconds, memory) {
  const { stiffness = 0, damping = 0 } = record.motion ?? {}
  const step = memory.seconds === undefined ? 0 : seconds - memory.seconds
  memory.seconds = seconds
  if (!memory.position || stiffness <= 0) {
    memory.position = wanted
    memory.velocity = [0, 0, 0]
    return wanted
  }
  const time = step > 0 && step < LONGEST_STEP ? step : 1 / 60
  memory.velocity = memory.velocity.map(
    (speed, axis) => speed + (stiffness * (wanted[axis] - memory.position[axis]) - damping * speed) * time
  )
  memory.position = memory.position.map((value, axis) => value + memory.velocity[axis] * time)
  return memory.position
}

/**
 * The constraints that hold `record`'s item this step, and where it hangs:
 * `{ constraints, attachment }`, or null when the skeleton lacks what it
 * needs. `pose` is the body before the hold (the clip's); `weight` scales the
 * record's own. `memory` is a record kept between steps for the spring.
 * `attachment` is `{ model, node, position, turn }`, `turn` a quaternion.
 */
export function heldPose({ record, skeleton, pose, seconds, memory, weight = 1 }) {
  const roles = rolesOf(skeleton)
  const arm = side => roles[side] && [roles[side].shoulder, roles[side].elbow, roles[side].hand]
  const holding = arm(record.hand)
  if (!roles.chest || !holding?.every(Boolean)) return null
  const strength = (record.weight ?? 1) * weight
  const chest = placeOf(skeleton, pose, roles.chest)
  const handPoint = sprungPoint(record, guardPoint(record, chest.position, seconds), seconds, memory)
  const reachOf = (side, point) => ({ kind: 'reach', nodes: arm(side), target: { model: point }, pole: { node: roles.chest, at: elbowOf(record, side) }, weight: strength })

  const mount = record.grip.mount
  if (mount) {
    const node = roles[record.hand][mount.on === 'hand' ? 'hand' : 'elbow']
    return {
      constraints: [reachOf(record.hand, handPoint)],
      attachment: { model: record.model, node, position: mount.position, turn: mount.turn }
    }
  }

  const sockets = record.grip.sockets
  const itemTurn = itemTurnOf(record, chest.turn)
  const origin = subtract(handPoint, rotate(itemTurn, sockets[record.hand].position))
  const lockedHand = side => {
    const handTurn = multiply(itemTurn, sockets[side].turn)
    return [
      reachOf(side, add(origin, rotate(itemTurn, sockets[side].position))),
      { kind: 'orient', node: roles[side].hand, aim: rotate(handTurn, [0, 0, 1]), upAim: rotate(handTurn, [0, 1, 0]), weight: strength }
    ]
  }
  // The holding hand first, so the other hand's socket is where the item is.
  const sides = [record.hand, ...(sockets[OTHER[record.hand]] && arm(OTHER[record.hand])?.every(Boolean) ? [OTHER[record.hand]] : [])]
  const turn = inverse(sockets[record.hand].turn)
  return {
    constraints: sides.flatMap(lockedHand),
    attachment: { model: record.model, node: roles[record.hand].hand, position: rotate(turn, scaled(sockets[record.hand].position, -1)), turn }
  }
}
