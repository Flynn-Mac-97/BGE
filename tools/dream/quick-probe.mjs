/**
 * One exploratory cost reading of a level, for a candidate working on a
 * renderer target.
 *
 * This is not the frozen evaluator and it is not a visual check. It starts the
 * same hidden browser the evaluator uses, samples a short warm run, and prints
 * the numbers with the paths it measured, so a candidate learns where a playing
 * frame goes without writing its own probe. The frozen setup decides the score
 * and a real playing check decides the picture.
 *
 *   node tools/dream/quick-probe.mjs --project <dir> [--level <name>] [--profile <file>]
 *
 * The defaults are for exploration: three seconds of warm play, thirty sampled
 * frames, and no heap cycles. A `--profile` file is a Chrome CPU profile of the
 * sampled frames, so a candidate can name a hotspot instead of guessing one.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { browserFrames } from './browser-frames.mjs'

const CHECKOUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

/** Exploration defaults: enough to rank a change, small enough to run often. */
export const QUICK_PROBE_DEFAULTS = { warmSeconds: 3, frames: 30, cycles: 0 }

const USAGE = `Usage: node tools/dream/quick-probe.mjs --project <dir> [options]

Exploratory frame-cost reading, not the frozen evaluator.

  --project <dir>       the game project to open (required)
  --level <name>        open this level instead of the project's start level
  --checkout <dir>      the engine checkout to serve (default: this checkout)
  --frames <n>          playing frames to sample (default: ${QUICK_PROBE_DEFAULTS.frames})
  --warm-seconds <n>    seconds of play before sampling (default: ${QUICK_PROBE_DEFAULTS.warmSeconds})
  --cycles <n>          play-and-stop rounds for the heap check (default: ${QUICK_PROBE_DEFAULTS.cycles})
  --size <WxH>          window size (default: 1280x720)
  --camera <json>       editor 3D view {x,y,z,yaw,pitch,fov} for the still picture
  --picture <png>       write the still frame here
  --compare-to <png>    compare the still frame with this PNG
  --profile <file>      write a Chrome CPU profile of the sampled playing frames
  --out <file>          write the whole result as JSON here as well

Prints one JSON result with its measures, its provenance and any problem.
`

/** The value flag each supported option reads, so an unknown flag is refused. */
const VALUE_FLAGS = {
  '--project': 'project',
  '--level': 'level',
  '--checkout': 'checkout',
  '--frames': 'frames',
  '--warm-seconds': 'warmSeconds',
  '--cycles': 'cycles',
  '--size': 'size',
  '--camera': 'camera',
  '--picture': 'picture',
  '--compare-to': 'compareTo',
  '--profile': 'profileOut',
  '--out': 'out'
}

/** A whole number of at least `least`, or an error naming the flag. */
function wholeNumber(flag, value, least) {
  const number = Number(value)
  if (!Number.isInteger(number) || number < least) return { error: `${flag} wants a whole number of at least ${least}, not ${JSON.stringify(value)}` }
  return { number }
}

/** A window size written `WxH`, or an error naming the flag. */
function windowSize(value) {
  const match = /^(\d+)x(\d+)$/.exec(String(value))
  if (!match) return { error: `--size wants WxH, for example 1280x720, not ${JSON.stringify(value)}` }
  return { size: [Number(match[1]), Number(match[2])] }
}

/**
 * The options a quick probe was asked for.
 *
 * Answers `{ options }`, `{ help: true }`, or `{ error }`. Every value is
 * checked here so a typo fails before a browser is started.
 */
export function parseQuickProbeArgs(argv = []) {
  const options = { ...QUICK_PROBE_DEFAULTS }
  for (let at = 0; at < argv.length; at++) {
    const name = argv[at]
    if (name === '--help' || name === '-h') return { help: true }
    const key = VALUE_FLAGS[name]
    if (!key) return { error: `unknown option ${JSON.stringify(name)}` }
    const value = argv[++at]
    if (value === undefined) return { error: `${name} needs a value` }

    if (name === '--frames' || name === '--warm-seconds' || name === '--cycles') {
      const parsed = wholeNumber(name, value, 0)
      if (parsed.error) return { error: parsed.error }
      options[key] = parsed.number
      continue
    }
    if (name === '--size') {
      const parsed = windowSize(value)
      if (parsed.error) return { error: parsed.error }
      options[key] = parsed.size
      continue
    }
    if (name === '--camera') {
      try {
        options.camera = JSON.parse(value)
      } catch {
        return { error: `--camera wants JSON, for example {"x":0,"y":8,"z":19}, not ${JSON.stringify(value)}` }
      }
      continue
    }
    options[key] = value
  }

  if (!options.project) return { error: '--project is required' }
  return { options }
}

/**
 * Measure one level once, with the exploration defaults.
 *
 * `measure` is injectable so a test can drive this without a browser. It has the
 * `browserFrames` signature. The result names exactly what was measured, so a
 * number without its checkout, project, level and sample size is never reported
 * as one that means more than it does.
 */
export async function quickProbe({
  checkout = CHECKOUT,
  project,
  level = null,
  size = [1280, 720],
  camera = null,
  picture = null,
  compareTo = null,
  warmSeconds = QUICK_PROBE_DEFAULTS.warmSeconds,
  frames = QUICK_PROBE_DEFAULTS.frames,
  cycles = QUICK_PROBE_DEFAULTS.cycles,
  profileOut = null,
  measure = browserFrames
} = {}) {
  const startedAt = new Date().toISOString()
  const started = Date.now()
  const absoluteProject = path.resolve(checkout, String(project))
  let answer = null
  let problem = null
  try {
    answer = await measure(checkout, absoluteProject, { level, size, camera, picture, compareTo, warmSeconds, frames, cycles, profileOut })
    problem = answer?.problem ?? null
  } catch (error) {
    problem = String(error?.message || error)
  }
  return {
    exploratory: true,
    note: 'exploratory only: the frozen setup scores a candidate, and a real playing check confirms the picture',
    ok: problem === null,
    problem,
    provenance: {
      checkout,
      project: absoluteProject,
      level,
      startedAt,
      durationMs: Date.now() - started,
      warmSeconds,
      frames,
      cycles,
      browser: answer?.measures?.browser ?? null,
      profile: profileOut
    },
    measures: answer?.measures ?? {},
    difference: answer?.difference ?? null,
    picture: answer?.picture ?? null
  }
}

/** Parse the command line, measure, print the result, and answer an exit code. */
export async function main(argv = process.argv.slice(2), { measure = browserFrames, stdout = process.stdout, stderr = process.stderr } = {}) {
  const parsed = parseQuickProbeArgs(argv)
  if (parsed.help) {
    stdout.write(USAGE)
    return 0
  }
  if (parsed.error) {
    stderr.write(`quick probe: ${parsed.error}\n\n${USAGE}`)
    return 1
  }
  const result = await quickProbe({ ...parsed.options, measure })
  const text = `${JSON.stringify(result, null, 2)}\n`
  if (parsed.options.out) fs.writeFileSync(parsed.options.out, text)
  stdout.write(text)
  return result.ok ? 0 : 1
}

// Run directly: measure once and exit with the result's own status.
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().then(code => { process.exitCode = code }).catch(error => {
    process.stderr.write(`quick probe: ${error?.stack || error}\n`)
    process.exitCode = 1
  })
}

export { CHECKOUT }
