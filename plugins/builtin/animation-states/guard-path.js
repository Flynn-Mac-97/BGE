/**
 * Animation States: an action made from keys, not a take. The held item's
 * guard (held-items.js) is moved over time, and the hands stay locked to the
 * item, so the item follows the keys and the arms follow it: a sword cut
 * across the body, an overhead chop, a shield pushed up.
 *
 * In a set file, an action gives two tracks of keys:
 *   attack: {
 *     hand: [                                       where the holding hand goes
 *       { at: 0, guard: {} },                       the item's own guard
 *       { at: 0.26, guard: { distance: 0, height: 0.25, side: 0.3 }, ease: 'sine-out' },
 *       { at: 1, guard: {} }
 *     ],
 *     blade: [                                      which way the item points, laid on the hand
 *       { at: 0, guard: {} },
 *       { at: 0.3, guard: { pitch: 50, yaw: -140 }, ease: 'cubic-in' },
 *       { at: 1, guard: {} }
 *     ],
 *     body: 0.4,                                    how much the spine follows (FOLLOW when left out)
 *     next: 'attack-2',                             the action a second ask chains into
 *     link: 0.6                                     where that chain cuts in; the rest is the recovery
 *   }
 * The hand track moves distance, height and side; the blade track pitch, yaw
 * and roll. A key gives only what changes; the rest is the item's own guard.
 * `path: [...]` instead gives one list of keys for both tracks.
 *
 * Each track passes smoothly through its keys (a Hermite spline): a key the
 * motion runs through keeps its speed, and a key that is a turning point, or
 * where the item rests, is a stop. `ease` is how the time runs from a key to
 * the next (engine/curve-eases.js): `linear` through a key, `sine-in-out` to
 * stop at it.
 *
 * `body` (0 to 1) is how much the spine turns and leans after the item: that
 * share of the guard's yaw and pitch away from the item's own.
 */
import { EASES } from '../../../engine/curve-eases.js'
import { rolesOf } from '../rig-animation/clip-reading.js'
import { add, scaled, subtract } from '../game-maths/space.js'
import { multiply, rotate, turnAbout } from '../game-maths/turns.js'
import { guardPoint, itemTurnOf } from './held-items.js'

const DEGREES = Math.PI / 180

/** How much the spine follows the item when an action names no `body`. */
export const FOLLOW = 0.3

/** Seconds between the ticks a drawn path shows: closer ticks are slower motion. */
const TICK_SECONDS = 1 / 30

/** The guard fields each track moves. */
export const TRACK_FIELDS = { hand: ['distance', 'height', 'side'], blade: ['pitch', 'yaw', 'roll'] }

/** A track an action leaves out: the item held at its own guard. */
const STILL = [{ at: 0, guard: {} }]

/** An action's keys by track: its own hand and blade, or its one path for both. */
export const tracksOf = action => ({ hand: action.hand ?? action.path ?? STILL, blade: action.blade ?? action.path ?? STILL })

/** True when an action moves the item by keys rather than playing a take. */
export const isPathAction = action => Boolean(action?.path?.length || action?.hand?.length || action?.blade?.length)

/** True when two values are the same numbers. */
const isSame = (first, second) => first.every((value, axis) => value === second[axis])

/**
 * Each key's slope, per field, in units a second: the slope of its two
 * neighbours; none at the first and last key, where the item rests either
 * side, or on a field the key is the top or the bottom of.
 */
function slopesOf(keys) {
  return keys.map((key, index) => {
    const before = keys[index - 1]
    const after = keys[index + 1]
    if (!before || !after || isSame(key.value, before.value) || isSame(key.value, after.value)) return key.value.map(() => 0)
    return key.value.map((value, axis) => {
      const isTurning = (value - before.value[axis]) * (after.value[axis] - value) <= 0
      return isTurning ? 0 : (after.value[axis] - before.value[axis]) / (after.at - before.at)
    })
  })
}

/** A value along a Hermite segment `share` of the way, from `from` to `onto`, with slopes already in segment units. */
function hermite(share, from, fromSlope, onto, ontoSlope) {
  const square = share * share
  const cube = square * share
  return from.map(
    (value, axis) =>
      (2 * cube - 3 * square + 1) * value + (cube - 2 * square + share) * fromSlope[axis] + (-2 * cube + 3 * square) * onto[axis] + (cube - square) * ontoSlope[axis]
  )
}

/** A spline through keys `{ at, value, ease }`: the value at any time, held before the first key and after the last. */
function splineOf(keys) {
  const slopes = slopesOf(keys)
  return seconds => {
    if (seconds <= keys[0].at) return keys[0].value
    const next = keys.findIndex(key => key.at > seconds)
    if (next === -1) return keys.at(-1).value
    const from = keys[next - 1]
    const span = keys[next].at - from.at
    const share = (EASES[from.ease] ?? EASES.linear)((seconds - from.at) / span)
    return hermite(share, from.value, scaled(slopes[next - 1], span), keys[next].value, scaled(slopes[next], span))
  }
}

/** One track's keys as spline keys over its fields; `start`, when given, is the guard its first key begins from. */
function trackKeysOf(keys, fields, guard, start) {
  return keys.map((key, index) => ({
    at: key.at,
    value: fields.map(field => (index === 0 && start ? start[field] : (key.guard?.[field] ?? guard[field] ?? 0))),
    ease: key.ease
  }))
}

/**
 * An action's motion over the item's own `guard`: `{ duration, guardAt(seconds) }`,
 * the guard at any time. `start`, when given, is the guard it begins from in
 * place of its first keys' own: where a chained action takes over.
 */
export function motionOf(action, guard, start = null) {
  const tracks = tracksOf(action)
  const splines = Object.entries(TRACK_FIELDS).map(([track, fields]) => [fields, splineOf(trackKeysOf(tracks[track], fields, guard, start))])
  return {
    duration: Math.max(tracks.hand.at(-1).at, tracks.blade.at(-1).at),
    guardAt: seconds => Object.fromEntries(splines.flatMap(([fields, spline]) => spline(seconds).map((value, index) => [fields[index], value])))
  }
}

/**
 * A chain of actions played one after another from `name`, each taking over
 * at the one before's `link` from where the item is: the same shape as
 * `motionOf`, with `steps: [{ name, from }]`, when each starts. `actions` is
 * the set's actions by name.
 */
export function comboOf(actions, name, guard) {
  const steps = []
  let start = null
  let at = 0
  for (let current = name; current && isPathAction(actions[current]) && !steps.some(step => step.name === current); current = actions[current].next) {
    const action = actions[current]
    const motion = motionOf(action, guard, start)
    const isChained = isPathAction(actions[action.next]) && !steps.some(step => step.name === action.next) && action.next !== current
    const length = isChained ? Math.min(action.link ?? motion.duration, motion.duration) : motion.duration
    steps.push({ name: current, from: at, motion })
    start = motion.guardAt(length)
    at += length
  }
  const stepAt = seconds => steps.findLast(step => seconds >= step.from) ?? steps[0]
  return {
    duration: at,
    steps: steps.map(({ name: stepName, from }) => ({ name: stepName, from })),
    guardAt: seconds => stepAt(seconds).motion.guardAt(seconds - stepAt(seconds).from)
  }
}

/** The hold record `seconds` along a motion: its guard moved, with no spring or sway to lag it. */
export const recordAlong = (record, motion, seconds) => ({ ...record, guard: motion.guardAt(seconds), motion: { ...record.motion, stiffness: 0, sway: 0 } })

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
 * The arcs a motion draws, in model space, from the chest where it is now
 * (`{ position, turn }`): `{ hand, tip }`, each `{ path, keys, ticks }` — the
 * points it passes through, where it is at each of `keyTimes.hand` or
 * `keyTimes.blade`, and where it is every TICK_SECONDS. The tip is
 * `record.length` metres along the item's axis from its origin, placed from
 * the holding hand's socket as the hold places the item; with no length, the
 * tip arc is left empty.
 */
export function pathLineOf(record, motion, chest, keyTimes) {
  const socket = record.grip.sockets?.[record.hand]
  const handAt = seconds => guardPoint(recordAlong(record, motion, seconds), chest.position, 0)
  const tipAt = seconds => {
    const moved = recordAlong(record, motion, seconds)
    return add(guardPoint(moved, chest.position, 0), rotate(itemTurnOf(moved, chest.turn), subtract(scaled(record.points.axis, record.length), socket.position)))
  }
  const times = [...Array.from({ length: Math.floor(motion.duration / TICK_SECONDS) + 1 }, (_, index) => index * TICK_SECONDS), motion.duration]
  const arcOf = (pointAt, keys) => ({ path: times.map(pointAt), keys: keys.map(pointAt), ticks: times.slice(0, -1).map(pointAt) })
  const hasTip = Boolean(record.length && socket)
  return { hand: arcOf(handAt, keyTimes.hand), tip: hasTip ? arcOf(tipAt, keyTimes.blade) : { path: [], keys: [], ticks: [] } }
}
