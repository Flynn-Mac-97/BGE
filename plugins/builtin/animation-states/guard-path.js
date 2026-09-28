/**
 * Animation States: an action made from a path, not a take. The held item's
 * guard (held-items.js) is moved through keys over time, and the hands stay
 * locked to the item, so the item follows the path and the arms follow it: a
 * sword cut across the body, an overhead chop, a shield pushed up.
 *
 * In a set file:
 *   attack: {
 *     path: [
 *       { at: 0, guard: {} },                                          the item's own guard
 *       { at: 0.25, guard: { height: 0.35, side: 0.35, pitch: 70, yaw: -60 }, ease: 'sine-in-out' },
 *       { at: 0.45, guard: { distance: 0.5, side: -0.1, pitch: 0, yaw: 40 }, ease: 'quad-out' },
 *       { at: 0.9, guard: {} }
 *     ]
 *   }
 * A key's guard gives only what changes; the rest is the item's own guard.
 * `ease` is how a key leaves for the next (engine/curves.js). The action's
 * `body` (0 to 1, FOLLOW when left out) is how much the spine turns and leans
 * after the item: that share of the guard's yaw and pitch away from the
 * item's own.
 */
import { makeCurve } from '../../../engine/curves.js'
import { rolesOf } from '../rig-animation/clip-reading.js'
import { add, scaled, subtract } from '../game-maths/space.js'
import { multiply, rotate, turnAbout } from '../game-maths/turns.js'
import { guardPoint, itemTurnOf } from './held-items.js'

const DEGREES = Math.PI / 180

/** How much the spine follows the item when an action names no `body`. */
export const FOLLOW = 0.3

/** Seconds between the ticks a drawn path shows: closer ticks are slower motion. */
const TICK_SECONDS = 1 / 30

/** The guard fields a path moves, in the order a curve value holds them. */
const GUARD_FIELDS = ['distance', 'height', 'side', 'pitch', 'yaw', 'roll']

/** The path's keys as a curve over the guard, each missing field the item's own. */
export function guardCurveOf(path, guard) {
  return makeCurve(
    path.map(key => ({
      at: key.at,
      value: GUARD_FIELDS.map(field => key.guard?.[field] ?? guard[field] ?? 0),
      ...(key.ease ? { ease: key.ease } : {})
    }))
  )
}

/** The guard at `seconds` along the curve. */
export const guardAt = (curve, seconds) => Object.fromEntries(curve.valueAt(seconds).map((value, index) => [GUARD_FIELDS[index], value]))

/** The hold record `seconds` along the curve: its guard moved, with no spring or sway to lag the path. */
export const recordAlong = (record, curve, seconds) => ({ ...record, guard: guardAt(curve, seconds), motion: { ...record.motion, stiffness: 0, sway: 0 } })

/** The spine from the hips' child up to the chest, lowest first; empty when the skeleton names no hips or chest. */
function spineOf(skeleton) {
  const { hips, chest } = rolesOf(skeleton)
  if (!hips || !chest) return []
  const nodes = []
  for (let node = chest; node && node !== hips; node = skeleton.nodes[node]?.parent) nodes.unshift(node)
  return nodes
}

/**
 * The twist that turns the spine after the item: `share` of the guard's yaw
 * and pitch away from `rest`, the item's own guard, as one constraint to
 * solve before the hands'. The pitch leans: an item raised leans the body
 * back, an item swung down leans it forward.
 */
export function followOf(skeleton, guard, rest, share) {
  const nodes = spineOf(skeleton)
  const yaw = (guard.yaw - (rest.yaw ?? 0)) * share * DEGREES
  const lean = -(guard.pitch - (rest.pitch ?? 0)) * share * DEGREES
  return { kind: 'twist', nodes, turn: multiply(turnAbout(1, yaw), turnAbout(0, lean)), weight: nodes.length ? 1 : 0 }
}

/**
 * The path drawn, in model space, from the chest where it is now (`{ position,
 * turn }`): `{ path, keys, ticks }`, the points the item's tip passes through,
 * where it is at each key, and where it is every TICK_SECONDS. The tip is
 * `record.length` metres along the item's axis from its origin, placed from
 * the holding hand's socket as the hold places the item; with no length, the
 * hand itself.
 */
export function pathLineOf(record, path, chest) {
  const curve = guardCurveOf(path, record.guard)
  const socket = record.grip.sockets?.[record.hand]
  const tipAt = seconds => {
    const moved = recordAlong(record, curve, seconds)
    const hand = guardPoint(moved, chest.position, 0)
    if (!record.length || !socket) return hand
    return add(hand, rotate(itemTurnOf(moved, chest.turn), subtract(scaled(record.points.axis, record.length), socket.position)))
  }
  const ticks = Array.from({ length: Math.floor(curve.duration / TICK_SECONDS) + 1 }, (_, index) => tipAt(index * TICK_SECONDS))
  return { path: [...ticks, tipAt(curve.duration)], keys: path.map(key => tipAt(key.at)), ticks }
}
