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
 * `ease` is how a key leaves for the next (engine/curves.js).
 */
import { makeCurve } from '../../../engine/curves.js'

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
