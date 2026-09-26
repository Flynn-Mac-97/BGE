/**
 * Kernel: a curve, a value that changes over time through keys and is eased
 * between them. Game code gets one from `context.curve(...)`.
 *
 *   const lift = context.curve([
 *     { at: 0, value: 0, ease: 'smooth' },
 *     { at: 0.3, value: 1, ease: 'back-out' },
 *     { at: 0.6, value: 0 }
 *   ])
 *   lift.valueAt(0.15) // 0.5
 *   context.curve('pop', { duration: 0.25, from: 0.5, to: 1 })        // a preset, as a scale
 *   context.curve('flash', { duration: 0.2, from: [1, 1, 1], to: [1, 0.2, 0.2] })  // as a colour
 *
 * `at` is seconds, rising from key to key. `value` is a number, or a list of
 * numbers such as a point or a colour; every key of one curve has the same
 * shape. `ease` is how the value leaves that key for the next: a name in
 * curve-eases.js, 'linear' when left out. Before the first key the curve is
 * its first value; after the last, its last value, or it starts again when it
 * loops. A preset (curve-presets.js) is named instead of keys.
 *
 * Options: `duration` (seconds a preset takes, 1 by default), `from` and `to`
 * (what a value of 0 and 1 become, a number or a list; left out, values are
 * as the keys give them) and `loop` (repeat; a looping preset repeats unless
 * told `loop: false`).
 */
import { EASES } from './curve-eases.js'
import { CURVE_PRESETS } from './curve-presets.js'

/**
 * A curve from keys or a preset name: `{ keys, duration, loop, valueAt(seconds) }`.
 * `duration` is the time of the last key. Throws, naming the key or the
 * preset, when it is not a curve.
 */
export function makeCurve(source, options = {}) {
  const preset = typeof source === 'string' ? presetNamed(source) : null
  const keys = preset ? scaledKeys(preset.keys, options) : source
  const refusal = refusalOf(keys) ?? rangeRefusal(keys, options)
  if (refusal) throw new Error(`curve: ${refusal}`)
  const checked = keys.map(key => ({ at: key.at, value: key.value, ease: key.ease ?? 'linear' }))
  const loop = options.loop ?? preset?.loop ?? false
  const toValue = mappingOf(options)
  const duration = checked.at(-1).at
  return {
    keys: checked,
    duration,
    loop,
    valueAt: seconds => toValue(valueAt(checked, loop && duration > 0 ? wrapped(seconds, duration) : seconds))
  }
}

/** Every ease and preset name, for a list to choose from: `{ eases, presets: { name: use } }`. */
export function curveNames() {
  return {
    eases: Object.keys(EASES),
    presets: Object.fromEntries(Object.entries(CURVE_PRESETS).map(([name, preset]) => [name, preset.use]))
  }
}

function presetNamed(name) {
  const preset = CURVE_PRESETS[name]
  if (!preset) throw new Error(`curve: no preset "${name}"; one of ${Object.keys(CURVE_PRESETS).join(', ')}`)
  return preset
}

/** A preset's line of keys (`at value ease, ...`) as key records, stretched over `duration` seconds. */
function scaledKeys(line, { duration = 1 }) {
  return line.split(',').map(text => {
    const [seconds, value, ease] = text.trim().split(/\s+/)
    return { at: Number(seconds) * duration, value: Number(value), ...(ease ? { ease } : {}) }
  })
}

/** A value from 0 to 1 mapped onto `from` to `to`; unchanged when neither is given. */
function mappingOf({ from, to }) {
  if (from === undefined && to === undefined) return value => value
  const start = from ?? 0
  const end = to ?? 1
  if (!Array.isArray(start)) return value => start + (end - start) * value
  return value => start.map((component, index) => component + (end[index] - component) * value)
}

/** Why `from` and `to` cannot map this curve, or null when they can. */
function rangeRefusal(keys, { from, to }) {
  if (from === undefined && to === undefined) return null
  if (widthOf(keys[0].value) !== 0) return 'from and to map a curve of single numbers'
  const width = widthOf(from ?? to)
  return width === widthOf(to ?? from) && width >= 0 ? null : 'from and to must be the same shape'
}

/** Why a key list is not a curve, or null when it is. */
function refusalOf(keys) {
  if (!Array.isArray(keys) || keys.length === 0) return 'needs a list of at least one key'
  const width = widthOf(keys[0].value)
  for (let index = 0; index < keys.length; index++) {
    const key = keys[index]
    if (!Number.isFinite(key.at)) return `key ${index} has no number at`
    if (index > 0 && key.at <= keys[index - 1].at)
      return `key ${index} is at ${key.at}, not after ${keys[index - 1].at}`
    if (widthOf(key.value) !== width) return `key ${index} value is not the same shape as key 0`
    if (key.ease !== undefined && !EASES[key.ease])
      return `key ${index} ease "${key.ease}" is not an ease in curve-eases.js`
  }
  return null
}

/** How many numbers a value is: 0 for a single number, the length for a list, -1 for neither. */
function widthOf(value) {
  if (Number.isFinite(value)) return 0
  return Array.isArray(value) && value.every(Number.isFinite) ? value.length : -1
}

/** Seconds brought into one loop of `duration`, never negative. */
const wrapped = (seconds, duration) => ((seconds % duration) + duration) % duration

/** The value at `seconds`, eased between the keys either side. */
function valueAt(keys, seconds) {
  if (seconds <= keys[0].at) return keys[0].value
  const next = keys.findIndex(key => key.at > seconds)
  if (next === -1) return keys.at(-1).value
  const from = keys[next - 1]
  const share = EASES[from.ease]((seconds - from.at) / (keys[next].at - from.at))
  return mix(from.value, keys[next].value, share)
}

/** A number or list of numbers `share` of the way from `from` to `onto`. */
function mix(from, onto, share) {
  if (!Array.isArray(from)) return from + (onto - from) * share
  return from.map((value, index) => value + (onto[index] - value) * share)
}
