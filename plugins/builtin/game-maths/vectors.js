/**
 * Game Maths: points and numbers as plain values. A point is `[x, y, z]`.
 * Every function answers a new value and changes none it is given.
 */

/** Radians in one degree. */
export const DEGREES = Math.PI / 180

/** `value` held between `lowest` and `highest`. */
export const clamp = (value, lowest, highest) => Math.min(highest, Math.max(lowest, value))

/** The number `amount` of the way from `from` to `onto`. */
export const lerp = (from, onto, amount) => from + (onto - from) * amount

/** The sum of two points. */
export const add = (first, second) => [first[0] + second[0], first[1] + second[1], first[2] + second[2]]

/** The point from `second` to `first`. */
export const subtract = (first, second) => [first[0] - second[0], first[1] - second[1], first[2] - second[2]]

/** A point times a number. */
export const scaled = (point, factor) => [point[0] * factor, point[1] * factor, point[2] * factor]

/** The dot product of two points. */
export const dot = (first, second) => first[0] * second[0] + first[1] * second[1] + first[2] * second[2]

/** The cross product of two points: at right angles to both, by the right-hand rule. */
export const cross = (first, second) => [
  first[1] * second[2] - first[2] * second[1],
  first[2] * second[0] - first[0] * second[2],
  first[0] * second[1] - first[1] * second[0]
]

/** How long a point is from the origin. */
export const lengthOf = point => Math.hypot(point[0], point[1], point[2])

/** A point of length 1 the same way, or the zero point unchanged. */
export const unit = point => scaled(point, 1 / (lengthOf(point) || 1))
