/**
 * Kernel: what a declared colour, intensity or vector means, and what to say
 * when it cannot be read.
 *
 * A value that cannot be read answers null rather than a guess, so the caller
 * can leave what it already had alone.
 */
import * as THREE from 'three/webgpu'
import { declaredNumber } from '../frame-plan.js'
import { reportOnce } from './report.js'

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i

/**
 * A declared colour, or null when it cannot be read.
 *
 * Three warns about a colour it does not understand and then quietly stays
 * white, which reads as "my tint did nothing". Check it here instead, so the
 * message names this renderer and the value that was wrong.
 */
export function readColour(value, where) {
  if (value === null || value === undefined) return null
  if (typeof value === 'number') return new THREE.Color(value)
  const text = String(value).toLowerCase()
  if (HEX.test(text) || text in THREE.Color.NAMES) return new THREE.Color(value)
  reportOnce(`[render] ${where}: cannot read colour ${JSON.stringify(value)}`)
  return null
}

/**
 * A light level, or null when the caller left it out.
 *
 * Omitting an argument has to mean "leave it alone", or a level that only wants
 * to change the sun's colour would silently black out its own sun.
 */
export function readIntensity(value, where) {
  if (value === null || value === undefined) return null
  const amount = Number(value)
  if (Number.isFinite(amount)) return amount
  reportOnce(`[render] ${where}: ${JSON.stringify(value)} is not an intensity`)
  return null
}

/**
 * Three numbers that were meant to be a position or a set of angles.
 *
 * Sway, kick and a weapon's fit in a fist all arrive every frame, so the name of
 * what went wrong is built only when something actually did. A missing axis is
 * zero rather than a complaint: leaving `z` out of a shift that is only sideways
 * is how anybody would write it.
 */
const readAxis = (given, where, axis) => {
  const value = given?.[axis]
  if (value === undefined || value === null) return 0
  return Number.isFinite(value) ? value : declaredNumber(value, 0, `${where}.${axis}`)
}

/** A `{x, y, z}` from a declaration, a missing axis being zero rather than a complaint. */
export const readVector = (given, where) => ({
  x: readAxis(given, where, 'x'),
  y: readAxis(given, where, 'y'),
  z: readAxis(given, where, 'z')
})
