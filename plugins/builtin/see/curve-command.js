/**
 * See: `see.curve`, a picture of engine curves (engine/curves.js).
 *
 *   see.curve                                  every ease and preset name, and nothing drawn
 *   see.curve '{"curve":"pop"}'                one curve; `duration`, `from`, `to` and `loop` as context.curve takes
 *   see.curve '{"curve":[{"at":0,"value":0,"ease":"back-out"},{"at":1,"value":1}]}'
 *   see.curve '{"curves":["pop","overshoot","settle"]}'   several overlaid, to compare
 *   see.curve '{"group":"motion"}'             a named sheet: ui, motion, object, effect, presets or eases
 *
 * It writes `agent-runs/see/<name>.png` and a `.json` beside it naming what
 * was drawn. It needs no renderer, so it works headless.
 */
import { curveNames, makeCurve } from '../../../engine/curves.js'
import { plotChart, plotSheet } from './curve-plot.js'
import { browserFiles, writeFrameFiles } from './frame-sketch.js'

/** What each sheet group draws, from the names. */
const GROUPS = {
  eases: names =>
    names.eases.map(ease => ({
      label: ease,
      keys: [
        { at: 0, value: 0, ease },
        { at: 1, value: 1 }
      ]
    })),
  presets: names => Object.keys(names.presets).map(preset => ({ label: preset, keys: preset })),
  ui: names => presetsFor(names, 'ui'),
  motion: names => presetsFor(names, 'motion'),
  object: names => presetsFor(names, 'object'),
  effect: names => presetsFor(names, 'effect')
}

const presetsFor = (names, use) =>
  Object.entries(names.presets)
    .filter(([, presetUse]) => presetUse === use)
    .map(([preset]) => ({ label: preset, keys: preset }))

/** Draw the curves `options` names, or answer every name when it names none. */
export async function seeCurve(options = {}) {
  const names = curveNames()
  if (options.group !== undefined && !GROUPS[options.group]) {
    return { error: `no group "${options.group}"; one of ${Object.keys(GROUPS).join(', ')}` }
  }
  const chosen = chosenCurves(options, names)
  if (!chosen) return { ...names, draw: 'name a curve, curves or a group' }
  let entries
  try {
    entries = chosen.map(entry => ({ label: entry.label, curve: makeCurve(entry.keys, curveOptions(options)) }))
  } catch (error) {
    return { error: error.message }
  }
  const image = options.group ? plotSheet(entries) : plotChart(entries, options.size)
  return writeImage(options.name || `curve-${options.group ?? 'chart'}`, image)
}

/** The labelled key lists or preset names to draw, or null when none is named. */
function chosenCurves(options, names) {
  if (options.group) return GROUPS[options.group](names)
  const given = options.curves ?? (options.curve === undefined ? null : [options.curve])
  return (
    given?.map((source, index) => ({
      label: typeof source === 'string' ? source : `curve ${index + 1}`,
      keys: source
    })) ?? null
  )
}

/** The options a curve takes, and no others. */
const curveOptions = ({ duration, from, to, loop }) => ({ duration, from, to, loop })

/** Write the picture as a PNG and its sidecar: on disk in node, as files for the CLI in the browser. */
async function writeImage(name, image) {
  const sidecar = { curves: image.legend, size: [image.width, image.height] }
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas')
    canvas.width = image.width
    canvas.height = image.height
    canvas.getContext('2d').putImageData(new ImageData(image.pixels, image.width, image.height), 0, 0)
    const dataUrl = canvas.toDataURL('image/png')
    return { dataUrl, __files: browserFiles(name, dataUrl.split(',')[1], sidecar), curves: image.legend }
  }
  const { encodePng } = await import(/* @vite-ignore */ '../../../tools/lib/texture.mjs')
  const written = await writeFrameFiles(name, encodePng(image.width, image.height, Buffer.from(image.pixels)), sidecar)
  return { files: written.files, curves: image.legend }
}
