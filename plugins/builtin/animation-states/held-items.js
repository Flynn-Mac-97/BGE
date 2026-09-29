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
 *                                        for the holding side; the other side is mirrored.
 *                                        Left out, each elbow follows its hand (ELBOW_FOLLOWS)
 *     guard: { distance, height, side, pitch, yaw, roll },   metres from the chest, degrees
 *     motion: { stiffness, damping, sway, swaySpeed },       the spring (0 stiffness: none)
 *     weight: 1,                         0 leaves the clip's hands, 1 holds fully
 *     length?: 0.95                      sockets only: metres from the item's origin to its tip
 *                                        along `points.axis`, where a drawn path (guard-path.js) follows
 *     set?: 'one-handed',                the set the item turns on
 *     offSet?: 'dual'                    the set it turns on held in the off hand (offHandRecord)
 *   }
 * Socket and mount numbers fit the rig they were set on; each rig's hands
 * differ, so an item set on one rig needs its grip set again on another.
 */
import { placeOf } from '../rig-animation/skeleton.js'
import { rolesOf } from '../rig-animation/clip-reading.js'
import { add, scaled, subtract, unit } from '../game-maths/space.js'
import { inverse, multiply, rotate, turnOnto } from '../game-maths/turns.js'
import { chosenElbow } from './elbow-choice.js'

const DEGREES = Math.PI / 180

/** The longest step the spring takes; a longer gap (a pause, a loop's wrap) is taken as one frame. */
const LONGEST_STEP = 0.1

/**
 * Where an elbow bends toward when the record names none: down, and a little
 * out, from halfway between the shoulder and the hand, in the chest's space.
 * It follows the hand, so an arm swung across the body bends its elbow out in
 * front, not back through the chest, and a raised sword keeps its elbow
 * under it; the wrist cocks to meet the grip.
 */
const ELBOW_FOLLOWS = [0.2, -0.5, 0]

/**
 * What a wrist on a grip may do (rig-animation/solvers/wrist.js): half its
 * twist rolls the forearm, and what is left is held to a wrist's range. Past
 * it the hand, and the item with it, turns no further than a person's would.
 */
const WRIST = { bend: 65, twist: 70, share: 0.5 }

/** Which way is out from the body along X for each side: the model's right is -X. */
const OUTWARD = { right: -1, left: 1 }

/** A turn seen in a mirror across X, the item's own X flipped with it, so it is a turn again. */
const mirroredTurn = ([x, y, z, w]) => [x, -y, -z, w]

/** A place, or a hand's grip, seen in the same mirror. */
const mirroredPlace = ([x, y, z]) => [-x, y, z]
const mirroredGrip = ({ position, turn, ...rest }) => ({ ...rest, position: mirroredPlace(position), turn: mirroredTurn(turn) })

/**
 * The hold record for the same item in the other hand: the holding hand's
 * grip and the guard seen in a mirror across the body (`side` is already
 * measured outward, so yaw and roll change sign). Only the holding hand's
 * socket is kept, so the other hand does not reach for a second grip. A
 * rig's left and right hand bones mirror each other, so one grip serves both.
 */
export function offHandRecord(record) {
  const { sockets, mount } = record.grip
  const guard = { ...record.guard, yaw: -(record.guard.yaw ?? 0), roll: -(record.guard.roll ?? 0) }
  const grip = mount ? { mount: mirroredGrip(mount) } : { sockets: { [OTHER[record.hand]]: mirroredGrip(sockets[record.hand]) } }
  return { ...record, hand: OTHER[record.hand], grip, guard }
}

/** The other hand. */
const OTHER = { right: 'left', left: 'right' }

/** An elbow offset for `side`, mirrored from the holding side's. */
const mirrored = ([x, y, z], side) => [Math.abs(x) * OUTWARD[side], y, z]

/**
 * The pole an elbow bends toward: the record's `elbow` from the chest, or, when
 * it names none, ELBOW_FOLLOWS from halfway between the shoulder and `hand`.
 */
function elbowPoleOf(record, side, chest, shoulder, hand) {
  if (record.elbow) return { model: add(chest.position, rotate(chest.turn, mirrored(record.elbow, side))) }
  const halfway = scaled(add(shoulder, hand), 0.5)
  return { model: add(halfway, rotate(chest.turn, mirrored(ELBOW_FOLLOWS, side))) }
}


/** The way the item points in the chest's space, a unit direction, by the guard's pitch and yaw. */
function pointingIn(guard) {
  const [pitchAngle, yawAngle] = [(guard.pitch ?? 0) * DEGREES, (guard.yaw ?? 0) * DEGREES]
  return [Math.sin(yawAngle) * Math.cos(pitchAngle), Math.sin(pitchAngle), Math.cos(yawAngle) * Math.cos(pitchAngle)]
}

/**
 * The item's turn in model space: its axis along the guard's pitch and yaw,
 * its up axis toward the body's outside or up, rolled about the way it
 * points, all in the chest's space.
 */
export function itemTurnOf(record, chestTurn) {
  const rollAngle = (record.guard.roll ?? 0) * DEGREES
  const pointing = pointingIn(record.guard)
  const upward = record.points.up === 'up' ? [0, 1, 0] : [OUTWARD[record.hand], 0, 0]
  const rolled = rotate([...scaled(unit(pointing), Math.sin(rollAngle / 2)), Math.cos(rollAngle / 2)], upward)
  return turnOnto(record.points.axis, record.points.upAxis, rotate(chestTurn, pointing), rotate(chestTurn, rolled))
}

/**
 * The least distance in front of the chest that keeps the arm out of the
 * torso, in metres: more as the hand crosses the body (a negative side) and as
 * it goes low; none once the hand is out past the body's side, fading in over
 * `fade` metres. Measured on a person-sized rig, arm and torso box together.
 */
const BODY_CLEAR = { front: 0.2, across: 1, low: 0.6, lowFrom: -0.05, outside: 0.32, fade: 0.1 }

/** Where the holding hand is asked to be, in model space, before the spring; never so near the chest that the arm goes into it. */
export function guardPoint(record, chest, seconds) {
  const { distance = 0.3, height = 0, side = 0.2 } = record.guard
  const inFront = Math.min(1, Math.max(0, (BODY_CLEAR.outside - side) / BODY_CLEAR.fade))
  const clear = inFront * (BODY_CLEAR.front + Math.max(0, -side) * BODY_CLEAR.across + Math.max(0, BODY_CLEAR.lowFrom - height) * BODY_CLEAR.low)
  const { sway = 0, swaySpeed = 0 } = record.motion ?? {}
  const phase = seconds * swaySpeed * 2 * Math.PI
  const drift = [Math.sin(phase) * sway, Math.sin(phase * 2) * sway * 0.5, 0]
  return add(add(chest, [OUTWARD[record.hand] * side, height, Math.max(distance, clear)]), drift)
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
 * record's own, and `hands` scales each hand: `{ holding, other }`, what an
 * action sets so its clip swings the item while the other hand keeps its grip.
 * `memory` is a record kept between steps for the spring.
 * `attachment` is `{ model, node, position, turn }`, `turn` a quaternion.
 */
export function heldPose({ record, skeleton, pose, seconds, memory, weight = 1, hands = {} }) {
  const roles = rolesOf(skeleton)
  const arm = side => roles[side] && [roles[side].shoulder, roles[side].elbow, roles[side].hand]
  const holding = arm(record.hand)
  if (!roles.chest || !holding?.every(Boolean)) return null
  const strengthOf = side => (record.weight ?? 1) * weight * ((side === record.hand ? hands.holding : hands.other) ?? 1)
  const chest = placeOf(skeleton, pose, roles.chest)
  const handPoint = sprungPoint(record, guardPoint(record, chest.position, seconds), seconds, memory)
  // The other hand is held near the holding hand, so both elbows follow the holding hand's point.
  const poleOf = side => elbowPoleOf(record, side, chest, placeOf(skeleton, pose, arm(side)[0]).position, handPoint)
  const reachOf = (side, point) => ({ kind: 'reach', nodes: arm(side), target: { model: point }, pole: poleOf(side), weight: strengthOf(side) })

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
  const holdingTurn = multiply(itemTurn, sockets[record.hand].turn)
  // On a grip each elbow goes where the wrist is easiest, down and clear of the chest (elbow-choice.js).
  const gripPoleOf = (side, point, turn) => ({
    model: chosenElbow({ skeleton, nodes: arm(side), shoulder: placeOf(skeleton, pose, arm(side)[0]).position, hand: point, handTurn: turn, chest, memory: (memory[`${side}Elbow`] ??= {}) })
  })
  const holdingHand = [
    { ...reachOf(record.hand, handPoint), pole: gripPoleOf(record.hand, handPoint, holdingTurn) },
    { kind: 'orient', node: roles[record.hand].hand, aim: rotate(holdingTurn, [0, 0, 1]), upAim: rotate(holdingTurn, [0, 1, 0]), weight: strengthOf(record.hand) },
    { kind: 'wrist', node: roles[record.hand].hand, ...WRIST, weight: strengthOf(record.hand) }
  ]
  const other = OTHER[record.hand]
  const hasOther = sockets[other] && arm(other)?.every(Boolean)
  // The other hand is locked to the holding hand as it ends up, not to the
  // guard, so it stays on the item when an action's clip swings it.
  const back = inverse(sockets[record.hand].turn)
  const otherAt = hasOther ? rotate(back, subtract(sockets[other].position, sockets[record.hand].position)) : null
  const otherTurn = hasOther ? multiply(back, sockets[other].turn) : null
  const second = hasOther
    ? [
        {
          kind: 'reach',
          nodes: arm(other),
          target: { node: roles[record.hand].hand, at: otherAt },
          pole: gripPoleOf(other, add(handPoint, rotate(holdingTurn, otherAt)), multiply(holdingTurn, otherTurn)),
          weight: strengthOf(other)
        },
        { kind: 'orient', node: roles[other].hand, aim: rotate(otherTurn, [0, 0, 1]), upAim: rotate(otherTurn, [0, 1, 0]), in: roles[record.hand].hand, weight: strengthOf(other) },
        { kind: 'wrist', node: roles[other].hand, ...WRIST, weight: strengthOf(other) }
      ]
    : []
  const turn = inverse(sockets[record.hand].turn)
  return {
    constraints: [...holdingHand, ...second],
    attachment: { model: record.model, node: roles[record.hand].hand, position: rotate(turn, scaled(sockets[record.hand].position, -1)), turn }
  }
}
