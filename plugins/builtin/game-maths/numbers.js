/**
 * Game Maths for plain numbers, the same in 2D and 3D games.
 */

/** Radians in one degree. */
export const DEGREES = Math.PI / 180

/** `value` held between `lowest` and `highest`. */
export const clamp = (value, lowest, highest) => Math.min(highest, Math.max(lowest, value))

/** The number `amount` of the way from `from` to `onto`. */
export const lerp = (from, onto, amount) => from + (onto - from) * amount
