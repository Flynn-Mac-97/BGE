/**
 * Game Maths in 3D: points as plain arrays `[x, y, z]`. Turns are turns.js;
 * 2D points are plane.js. Every function answers a new array and changes none
 * it is given.
 */

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
