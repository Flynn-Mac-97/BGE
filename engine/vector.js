/**
 * Kernel: a point or a direction out of an event payload, read the one way.
 *
 * Events, commands and hand-typed arguments write a point two ways — `{x, y, z}`
 * from code, `[x, y, z]` from a terminal — and nine plugins each wrote their own
 * reader. Three of those ask different questions, and the difference is not
 * cosmetic:
 *
 *   `asVector`         an axis the payload left out is zero. A trigger point
 *                      written `{y: 2}` is at x 0, z 0, deliberately.
 *   `asWrittenVector`  null unless the payload wrote a number, so `{}` means
 *                      "nowhere" rather than the world origin.
 *   `asFiniteVector`   null unless all three axes are real numbers. Where a shot
 *                      came from has no safe default: `+value[0] || 0` rewrote a
 *                      bad coordinate to zero, moved the ray to the world origin
 *                      and then returned a hit — a confident, precise, wrong
 *                      answer about what a bullet struck.
 *
 * `normalise` takes the length off a direction, because one typed at a terminal
 * never has none.
 */

/** A point written `{x, y, z}` or `[x, y, z]`; an axis the payload left out is zero. */
export function asVector(value) {
  if (Array.isArray(value)) return { x: +value[0] || 0, y: +value[1] || 0, z: +value[2] || 0 }
  if (value && typeof value === 'object') return { x: +value.x || 0, y: +value.y || 0, z: +value.z || 0 }
  return null
}

/** The same, or null when the payload wrote no number at all. */
export function asWrittenVector(value) {
  if (Array.isArray(value)) return { x: +value[0] || 0, y: +value[1] || 0, z: +value[2] || 0 }
  if (!value || typeof value !== 'object') return null
  if (typeof value.x !== 'number' && typeof value.y !== 'number' && typeof value.z !== 'number') return null
  return { x: +value.x || 0, y: +value.y || 0, z: +value.z || 0 }
}

/** The same, or null unless every axis is a finite number. */
export function asFiniteVector(value) {
  const written =
    Array.isArray(value) ? [value[0], value[1], value[2]]
    : (value && typeof value === 'object') ? [value.x, value.y, value.z]
    : null
  if (!written) return null
  const [x, y, z] = written.map(Number)
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null
  return { x, y, z }
}

/** A direction of any length as a unit one, or null when there is no direction. */
export function normalise(vector) {
  if (!vector) return null
  const length = Math.hypot(vector.x, vector.y, vector.z)
  if (!(length > 0)) return null
  return { x: vector.x / length, y: vector.y / length, z: vector.z / length }
}
