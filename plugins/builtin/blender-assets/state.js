/**
 * Whether a built model still matches its `.blend`, and what the names are.
 *
 * Pure: no disk, no node, no DOM. The panel in the browser and the importer in
 * node both decide staleness here, so the panel never says fresh about a file
 * the importer would rebuild.
 */

/** What an author may set. Anything else in the settings file is ignored. */
export const DEFAULT_SETTINGS = {
  /** Multiplies every exported size. 1 means one Blender unit is one metre. */
  scale: 1,
  /** Export shapes as modifiers leave them, not as the base mesh. */
  applyModifiers: true,
  /** Export only this collection. Null exports the whole file. */
  collection: null,
  /**
   * Bake procedural material colour to an image before exporting.
   *
   * glTF carries fixed values and image textures, not a node graph, so a
   * material driven by noise or a colour ramp exports as flat grey. Baking
   * costs a Cycles render per mesh; off by default for that reason.
   */
  bake: false,
  /** The baked image's width and height in pixels. */
  bakeSize: 1024,
  /** Cycles samples per bake. Colour alone needs few. */
  bakeSamples: 16,
  /**
   * Write each material's node graph beside the model.
   *
   * A `.glb` cannot hold a node graph. The Blender Shaders plugin rebuilds the
   * material from this file, so a look designed in Blender needs no second
   * version written by hand.
   */
  shaders: true
}

/** The settings and receipt file for a `.blend`, as a path from `project/`. */
export const settingsFile = blend => blend.replace(/\.blend$/i, '.import.json')

/** The built model for a `.blend`, as a path from `project/`. */
export const modelFile = blend => blend.replace(/\.blend$/i, '.glb')

/** The material node graphs for a `.blend`, as a path from `project/`. */
export const graphFile = blend => blend.replace(/\.blend$/i, '.shaders.json')

/**
 * Read the settings file: what the author asked for, and what was built.
 *
 * One file holds both, because they are always read together and a second file
 * per asset doubles what an author has to keep in step. Unreadable or missing
 * text means defaults and nothing built — the state a new `.blend` is in.
 */
export function readSettings(text) {
  let stored = {}
  try { stored = JSON.parse(text) || {} } catch { stored = {} }
  const settings = { ...DEFAULT_SETTINGS }
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    if (stored[key] !== undefined) settings[key] = stored[key]
  }
  return { settings, built: stored.built || null }
}

/** The settings file's text, with the receipt the importer just wrote. */
export function writeSettings({ settings, built }) {
  const out = {}
  for (const key of Object.keys(DEFAULT_SETTINGS)) out[key] = settings[key]
  out.built = built
  return JSON.stringify(out, null, 2) + '\n'
}

/** True when two settings objects would produce the same export. */
const sameSettings = (a, b) =>
  Object.keys(DEFAULT_SETTINGS).every(key => (a?.[key] ?? null) === (b?.[key] ?? null))

/**
 * Whether the `.blend` needs importing again.
 *
 * `source` is the `.blend` as it is now: `modified` in WHOLE SECONDS and
 * `size` in bytes. Seconds because node reads a file's time in milliseconds
 * while the browser reads it from a `Last-Modified` header, which carries
 * seconds — comparing the two at full resolution calls every file stale.
 *
 * Returns `never`, `stale` or `fresh`, and why.
 */
export function importState({ built, settings, source, modelExists = true }) {
  if (!built) return { state: 'never', why: 'not imported yet' }
  if (!modelExists) return { state: 'stale', why: 'the built model is gone' }
  if (!sameSettings(built.settings, settings)) return { state: 'stale', why: 'settings changed' }
  if (!source) return { state: 'stale', why: 'the .blend cannot be read' }
  if (built.modified !== source.modified) return { state: 'stale', why: 'the .blend was edited' }
  if (built.size !== source.size) return { state: 'stale', why: 'the .blend changed size' }
  return { state: 'fresh', why: 'the model matches the .blend' }
}

/** A file's time as the receipt stores it: whole seconds. */
export const inSeconds = milliseconds => Math.floor(milliseconds / 1000)
