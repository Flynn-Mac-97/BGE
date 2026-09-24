/**
 * Read a project off disk and say what is in it.
 *
 * This built `.engine/index.json` from inside the dev server. It moved out here
 * so a world running in node builds the same index from the same code — a
 * second implementation would drift, and the index is the one thing every agent
 * trusts. The dev server imports it, the headless runner imports it, and
 * `engine check` gives the same verdict either way.
 *
 * Node only: it reads files and imports them. Nothing in the browser half of
 * the engine may import this.
 */
import fs from 'node:fs/promises'
import * as nodeModule from 'node:module'
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { assetPath } from './asset-path.js'
import { lint } from './index-lint.js'
import { invariantProblems, tintProblems } from './index-invariants.js'
import { writeIndexFiles } from './index-writer.mjs'

// The determinism lint and the invariant checks live in their own files
// beside this one. They are re-exported here because this module is the
// seam callers and tests import; moving the code must not move the door.
export { lint }
export { invariantProblems, tintProblems }

/** The checkout this module was loaded from. The engine's own plugins are here. */
const CHECKOUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// Where a named asset is stored is the one rule this file shares with the
// browser, so it is imported from the pure module both halves may import
// rather than copied. Not re-exported: a second door onto one rule is how the
// copies started.

/** The hook names a type or behaviour may define, in call order. */
export const HOOKS = ['start', 'update', 'onCollide', 'onDestroy']

/** Folder prefixes a project file's kind comes from, most specific first. */
const KIND_BY_PREFIX = [
  ['types/', 'type'],
  ['behaviours/', 'behaviour'],
  ['levels/', 'level'],
  ['tests/', 'test']
]

/** Extensions a project file's kind comes from. */
const KIND_BY_EXTENSION = [
  [/\.(png|jpg|jpeg|webp|gif|svg)$/i, 'image'],
  [/\.(wav|mp3|ogg)$/i, 'sound'],
  [/\.(glb|gltf)$/i, 'model']
]

/** The kind of thing a project file is, from its folder and extension. */
export function KIND(file) {
  const byPrefix = KIND_BY_PREFIX.find(([prefix]) => file.startsWith(prefix))
  if (byPrefix) return byPrefix[1]
  const byExtension = KIND_BY_EXTENSION.find(([pattern]) => pattern.test(file))
  return byExtension ? byExtension[1] : 'config'
}

/** Every file under a directory, as paths relative to it. A directory that will not read yields nothing. */
export async function walk(directory, base = '') {
  // One recursive listing rather than one readdir per folder. The tree read is
  // the same; what falls is the number of directory reads a build pays for.
  let items
  try {
    items = await fs.readdir(directory, { recursive: true, withFileTypes: true })
  } catch {
    return walkByFolder(directory, base)
  }
  const root = path.resolve(directory)
  const out = []
  for (const item of items) {
    const rel = path
      .relative(root, path.join(item.parentPath ?? root, item.name))
      .split(path.sep)
      .join('/')
    if (rel.split('/').some(part => part.startsWith('.'))) continue
    if (!item.isDirectory()) out.push(base ? `${base}/${rel}` : rel)
  }
  return out
}

/** The per-folder walk, for a node whose `readdir` has no recursive listing. */
async function walkByFolder(directory, base = '') {
  const out = []
  let items
  try {
    items = await fs.readdir(directory, { withFileTypes: true })
  } catch {
    return out
  }
  for (const item of items) {
    if (item.name.startsWith('.')) continue
    const rel = base ? `${base}/${item.name}` : item.name
    if (item.isDirectory()) out.push(...(await walkByFolder(path.join(directory, item.name), rel)))
    else out.push(rel)
  }
  return out
}

/**
 * Every file a type or a placement names, and the key that named it.
 *
 * One function for both, because a placement may write any of these keys itself
 * — `de_dust2.json` gives nearly every brush its own `mesh.texture` — and a rule
 * that only knew about types would have validated the smaller half of the
 * project. Miss a key here and a missing file goes unreported, which is the
 * failure this exists to prevent.
 */
export function assetReferences(source) {
  const out = []
  const add = (value, where) => {
    if (typeof value === 'string' && value.trim()) out.push({ reference: value, where })
  }
  if (!source || typeof source !== 'object') return out

  // `sprite` is a string when simple and an object when detailed, and the object
  // may point at a single `image` or at a `sheet`.
  if (typeof source.sprite === 'string') add(source.sprite, 'sprite')
  else if (source.sprite) {
    add(source.sprite.sheet, 'sprite.sheet')
    add(source.sprite.image, 'sprite.image')
  }

  // `mesh` follows the same shorthand: a string is the texture, an object spells
  // out a texture, a model and a baked lightmap.
  if (typeof source.mesh === 'string') add(source.mesh, 'mesh')
  else if (source.mesh) {
    add(source.mesh.texture, 'mesh.texture')
    add(source.mesh.model, 'mesh.model')
    add(source.mesh.lightmap, 'mesh.lightmap')
  }

  add(source.model, 'model')
  for (const [name, file] of Object.entries(source.sounds || {})) add(file, `sounds.${name}`)
  return out
}

/** The names in an attachment list, whichever of the two forms it was written in. */
export function attachedNames(value) {
  if (!value) return []
  if (Array.isArray(value)) return value.filter(name => typeof name === 'string')
  return Object.entries(value)
    .filter(([, config]) => config !== false)
    .map(([name]) => name)
}

let readCount = 0

/**
 * A changing query so a re-import sees the file as it is now.
 *
 * Node caches a module by URL for the life of the process, and both the dev
 * server and a long-running headless session rebuild the index after a write —
 * without this they would keep reporting the version they first read.
 */
const importFresh = async abs => (await import(pathToFileURL(abs).href + '?read=' + ++readCount)).default || {}

/**
 * The type names one plugin's source registers, by the text the loader runs.
 *
 * `world.retype('light', LIGHT_TYPE)` is the only way a plugin contributes a
 * type, so the name is the first argument. Being a text read is safe in the one
 * direction that matters: a registration written some other way is missed and
 * the old false report comes back, and nothing is ever wrongly called present.
 */
export function registeredTypeNames(text) {
  const out = []
  for (const match of String(text || '').matchAll(/\bretype\s*\(\s*['"`]([\w-]+)['"`]/g)) out.push(match[1])
  return out
}

/**
 * The generated list of type names the checkout's own plugins register.
 *
 * Reading every builtin plugin source to learn two names cost one rebuild a
 * hundred directory reads and a megabyte of bytes. The list changes only when an
 * engine plugin changes, and the dev server writes this file at start-up with
 * the rest of the generated agent files; `check` holds it to the sources. A
 * checkout without it falls back to the source scan below, so the index still
 * answers.
 */
export const BUILTIN_REGISTERED_TYPES = 'plugins/builtin/registered-types.generated.json'

/** The builtin plugin directory, where the loader looks for engine plugins. */
const builtinPlugins = checkout => path.join(checkout, 'plugins/builtin')

/** Read the generated catalog, or scan the sources when there is none. */
async function builtinRegisteredTypes(checkout) {
  const stored = await fs.readFile(path.join(checkout, BUILTIN_REGISTERED_TYPES), 'utf8').then(
    text => JSON.parse(text),
    () => null
  )
  if (Array.isArray(stored?.types)) return stored.types
  const names = (await fs.readdir(builtinPlugins(checkout)).catch(() => [])).filter(name => name.endsWith('.js'))
  const texts = await Promise.all(
    names.map(name => fs.readFile(path.join(builtinPlugins(checkout), name), 'utf8').catch(() => ''))
  )
  return [...new Set(texts.flatMap(registeredTypeNames))].sort()
}

/**
 * Source text of every file module the loader has run, by absolute path.
 *
 * Two readers want the same bytes the loader already read. The index lints
 * every project `.js` file as text and then imports it for its properties and
 * hooks; `check` imports every plugin to prove it loads and then reads its guide
 * and source as text. The loader holds the text either way, so recording it lets
 * the second read go. A file this process never imported is not here, and the
 * reader falls back to disk exactly as it did before.
 */
const loadedSources = new Map()

/** Whether the recording hook is already installed. One module load is enough. */
let sourceRecorderInstalled = false

/**
 * Record the source of every file module this process loads.
 *
 * The hook is in front of the standard loader and returns its result
 * untouched: this observes, it never changes what loads. Node without
 * `registerHooks` records nothing, and every reader falls back to disk.
 */
export function recordModuleSources() {
  if (sourceRecorderInstalled) return
  sourceRecorderInstalled = true
  if (typeof nodeModule.registerHooks !== 'function') return
  nodeModule.registerHooks({
    load(url, context, nextLoad) {
      const result = nextLoad(url, context)
      if (typeof url === 'string' && url.startsWith('file:') && result && result.source != null) {
        // The loader hands the text back as bytes; a reader wants the same
        // string a disk read would have produced.
        const text = typeof result.source === 'string' ? result.source : Buffer.from(result.source).toString('utf8')
        loadedSources.set(path.resolve(fileURLToPath(url.split('?')[0].split('#')[0])), text)
      }
      return result
    }
  })
}

/** The source text this process loaded for a file, or undefined when it never did. */
export const loadedModuleSource = file => loadedSources.get(path.resolve(file))

/**
 * Type names a plugin registers, which therefore have no file under `types/`.
 *
 * `light` is the one that exists today: Lights registers it with
 * `world.retype('light', LIGHT_TYPE)` because a lamp is an engine feature rather
 * than a fact about one game, and copying a `light.js` into every project that
 * ever wanted one would be worse. The cost was that `check` called every level
 * with a light in it broken — "there is no project/types/light.js, so those
 * placements are empty" — while the light drew perfectly.
 *
 * Found by reading the plugins as TEXT rather than by importing them. A plugin
 * is browser code that may pull in three or touch the DOM, and node has no
 * business running forty of them to learn one string.
 *
 * Only the top level of a plugin directory is loaded: `findPlugins` reads one
 * directory and imports the `.js` files directly in it, so a nested file runs
 * only if a plugin imports it, and it has no world to register against. So a
 * nested file cannot contribute a type, and reading the tree charged one rebuild
 * for every guide and asset folder under `plugins/builtin`.
 */
async function typesRegisteredByPlugins(projectFiles, projectDirectory, checkout, sources) {
  const found = new Set(await builtinRegisteredTypes(checkout))
  const project = projectFiles.filter(file => /^plugins\/[^/]+\.js$/.test(file))
  const texts = await Promise.all(
    project.map(file =>
      fs.readFile(path.join(projectDirectory, file), 'utf8').then(
        text => text,
        () => null
      )
    )
  )
  project.forEach((file, index) => {
    // A plugin file is read once here for the names it registers and again by
    // the determinism lint below. Hand the text over so the lint can skip its read.
    if (texts[index] === null) return
    sources.set(file, texts[index])
    for (const name of registeredTypeNames(texts[index])) found.add(name)
  })
  return [...found].sort()
}

/** Read one project file into the index, through its kind's reader or as an asset. */
async function readIndexFile(index, file, inside, levelPlacements) {
  const kind = KIND(file)
  const reader = READERS[kind]
  // A file no reader names is data a level may reference, so it is an asset.
  if (reader) await reader(index, file, inside, levelPlacements)
  else index.assets[path.basename(file)] = { file, kind, usedBy: [] }
}

/**
 * Lint one hand-written JS file against the determinism rules.
 *
 * Every such file runs inside the fixed step, so every one is held to them. A
 * file the reader just imported is linted from the text the loader read; a
 * project plugin was read for its registrations; anything else is read here.
 */
async function lintSourceFile(index, file, inside, pluginSources) {
  if (!file.endsWith('.js')) return
  const text = loadedModuleSource(inside(file)) ?? pluginSources.get(file) ?? (await fs.readFile(inside(file), 'utf8'))
  index.warnings.push(...lint(file, text))
}

/** Point every type's asset references back at the type that uses them. */
function linkTypeAssets(index, name, type, assetFor) {
  for (const reference of type.uses || []) assetFor(reference)?.usedBy.push(name)
}

/** Point every type's behaviour references back at the type that uses them. */
function linkTypeBehaviours(index, name, type) {
  for (const behaviour of type.behaviours || []) {
    if (index.behaviours[behaviour]) index.behaviours[behaviour].usedBy.push(name)
  }
}

/** Count the levels that place each type. */
function countLevelTypes(index, level) {
  for (const type of level.types || []) if (index.types[type]) index.types[type].inLevels++
}

/** Point every level's behaviour references back at the level that uses them. */
function linkLevelBehaviours(index, name, level) {
  for (const behaviour of level.behaviours || []) {
    if (index.behaviours[behaviour]) index.behaviours[behaviour].usedBy.push(name)
  }
}

/** Point every level's asset references back at the level that uses them. */
function linkLevelAssets(index, name, level, assetFor) {
  for (const reference of Object.keys(level.assets || {})) assetFor(reference)?.usedBy.push(name)
}

/**
 * Build the index — the one artifact both the browser UI and the AI read.
 * Types are imported rather than parsed so `properties` and asset references
 * are exact.
 */
export async function buildIndex(projectDirectory, checkout = CHECKOUT, { write = true } = {}) {
  const files = await walk(projectDirectory)
  // The text of every project plugin, read to find the types it registers. The
  // lint below reuses it rather than reading the same file again.
  const pluginSources = new Map()
  // Every file in the project, by its path from `project/`. `assets` is keyed by
  // basename and so cannot answer "is this exact file there" — two folders may
  // hold a `jump.wav` — and that question is the one the asset check asks.
  const index = {
    types: {},
    behaviours: {},
    levels: {},
    tests: {},
    assets: {},
    files,
    config: [],
    warnings: [],
    pluginTypes: await typesRegisteredByPlugins(files, projectDirectory, checkout, pluginSources)
  }
  /** One project file by its path from the project directory. */
  const inside = file => path.join(projectDirectory, file)

  // Raw placements, kept only for the invariant pass below and never written
  // to `index`: a level of nine hundred entities copied onto the index would
  // double what `.engine/index.json` costs to write and read on every check,
  // for data only this one pass needs.
  const levelPlacements = {}

  // Record what the loader reads, so a file imported below for its properties
  // and hooks is not read a second time as text for the determinism lint.
  recordModuleSources()

  for (const file of files) {
    await readIndexFile(index, file, inside, levelPlacements)
    await lintSourceFile(index, file, inside, pluginSources)
  }

  // relationships: assets -> types that reference them, types -> levels that place them
  // Matched on the resolved path, not on the reference as written: an asset in a
  // subfolder is named `counter-strike/wall.png` and filed under `wall.png`, so
  // looking it up by the reference found nothing and every subfolder asset read
  // as unused — which reads as "safe to delete".
  const assetByPath = new Map(Object.values(index.assets).map(asset => [asset.file, asset]))
  /** The asset entry a reference resolves to, or undefined when no file is there. */
  const assetFor = reference => assetByPath.get(assetPath(reference))

  for (const [name, type] of Object.entries(index.types)) {
    linkTypeAssets(index, name, type, assetFor)
    linkTypeBehaviours(index, name, type)
  }
  for (const [name, level] of Object.entries(index.levels)) {
    countLevelTypes(index, level)
    linkLevelBehaviours(index, name, level)
    linkLevelAssets(index, name, level, assetFor)
  }

  // Every type is loaded by this point; a level can be walked before the type
  // it places, so checking placements while `index.types` is still filling in
  // would miss a type read later and silently pass every placement of it.
  index.invariantProblems = invariantProblems(index, levelPlacements)
  index.tintProblems = tintProblems(index, levelPlacements)

  // A caller that only reads the answer — `check` — does not write it to disk.
  // The routes that own the generated files (`index`, a write, a boot) pass
  // `write: true`; the reader pays no serialized characters and leaves no file
  // for a later reader to mistake for fresh.
  if (!write) return index

  await writeIndexFiles(projectDirectory, index)
  return index
}

/**
 * One reader per file kind, each writing into the index it is handed.
 *
 * The readers share nothing but the index and the file they read, so a kind is
 * added in one place: a function, and its row here. Everything no reader names
 * is data a level may reference, and is filed as an asset.
 */
const READERS = {
  type: async (index, file, inside) => {
    index.types[path.basename(file, '.js')] = await readType(inside(file), file)
  },
  behaviour: async (index, file, inside) => {
    index.behaviours[path.basename(file, '.js')] = await readBehaviour(inside(file), file)
  },
  level: async (index, file, inside, levelPlacements) => {
    const level = await readLevel(inside(file), file)
    index.levels[level.name] = level.entry
    // Kept out of the index: a level of nine hundred entities copied onto it
    // would double what `.engine/index.json` costs to write and read on every
    // check, for data only the invariant pass needs.
    if (level.placements) levelPlacements[level.name] = level.placements
  },
  test: async (index, file, inside) => {
    index.tests[path.basename(file, '.js')] = await readTest(inside(file), file)
  },
  config: async (index, file) => {
    index.config.push(file)
  }
}

/** Every way a type can name a file, and which key named which. */
function readTypeReferences(entry, loaded) {
  // See assetReferences, which the level placements go through too. Miss any of
  // these and "used by" quietly goes empty, which reads as "nothing uses this,
  // safe to delete", and a missing file goes unreported by `check`.
  const references = assetReferences(loaded)
  entry.uses = references.map(reference => reference.reference)
  // Which key named which file, so a missing one can be reported with the line
  // the author would have to go and fix.
  entry.usesBy = Object.fromEntries(references.map(reference => [reference.reference, reference.where]))
}

/**
 * What the author says this type is, how a correct one reads on screen, and how
 * a broken one reads. Carried here so reading the index answers "what is a
 * brush" with no call and no guess from the name.
 */
function readTypeDescription(entry, loaded) {
  if (loaded.about) entry.about = String(loaded.about)
  if (loaded.appearance) entry.appearance = String(loaded.appearance)
  if (loaded.looksWrongWhen) entry.looksWrongWhen = String(loaded.looksWrongWhen)
}

/**
 * A rule `check` enforces against every placement of this type. Kept beside
 * `about`/`appearance` because it is the same kind of fact — written once next
 * to the type, read by every level that places it. `meshBox`/`colliderBox` are
 * the type's own defaults, stored only when an invariant is declared, so a type
 * that never opts in pays nothing: see `placedHeight` for why both are needed.
 */
function readTypeInvariant(entry, loaded) {
  if (!loaded.invariant) return
  entry.invariant = loaded.invariant
  if (Array.isArray(loaded.mesh?.box)) entry.meshBox = loaded.mesh.box
  if (Array.isArray(loaded.collider?.box)) entry.colliderBox = loaded.collider.box
}

/** A tint on a type multiplies into every textured placement that did not state its own. */
function readTypeTint(entry, loaded) {
  if (loaded.mesh?.tint != null) entry.meshTint = loaded.mesh.tint
}

/** The animation names the type declares. */
function readTypeAnimation(entry, loaded) {
  if (loaded.animation) entry.animation = Object.keys(loaded.animation)
}

/**
 * What this type composes. Listed here so "what does a crate do" is one index
 * lookup rather than opening the type and then every behaviour.
 */
function readTypeBehaviours(entry, loaded) {
  const attached = attachedNames(loaded.behaviours)
  if (attached.length) entry.behaviours = attached
}

/** One type file: what it declares, what it names, and how it reads on screen. */
async function readType(file, relative) {
  const entry = { file: relative, properties: [], uses: [], inLevels: 0 }
  try {
    const loaded = await importFresh(file)
    entry.properties = Object.keys(loaded.properties || {})
    readTypeReferences(entry, loaded)
    entry.hooks = HOOKS.filter(hook => typeof loaded[hook] === 'function')
    readTypeDescription(entry, loaded)
    readTypeInvariant(entry, loaded)
    readTypeTint(entry, loaded)
    readTypeAnimation(entry, loaded)
    readTypeBehaviours(entry, loaded)
  } catch (error) {
    entry.error = String(error.message || error)
  }
  return entry
}

/** One behaviour file. Values, not just keys, because a behaviour is attached from a list. */
async function readBehaviour(file, relative) {
  const entry = { file: relative, properties: {}, hooks: [], usedBy: [] }
  try {
    const loaded = await importFresh(file)
    // Values, not just keys, unlike a type. A behaviour is attached from a
    // list without ever opening it, so its defaults have to be readable
    // from here or nobody knows what they are agreeing to.
    entry.properties = loaded.properties || {}
    entry.hooks = HOOKS.filter(hook => typeof loaded[hook] === 'function')
    if (loaded.about) entry.about = String(loaded.about)
  } catch (error) {
    entry.error = String(error.message || error)
  }
  return entry
}

/** One level file: its placements, and every asset it names with a count. */
async function readLevel(file, relative) {
  const name = path.basename(relative, '.json')
  try {
    const raw = JSON.parse(await fs.readFile(file, 'utf8'))
    const placed = raw.entities || []

    /**
     * Every asset the level itself names, deduped, with how many placements
     * named it and the first one that did.
     *
     * Deduped because a 281-brush map names the same texture forty times and
     * a missing one should be one line with a count, not forty lines.
     * Counted because "231 references" and "one reference" are different
     * problems and an agent needs to know which it is reading.
     */
    const assets = {}
    const note = (reference, where) => {
      const seen = assets[reference] || (assets[reference] = { count: 0, first: where })
      seen.count++
    }
    placed.forEach((placement, index) => {
      const named = placement?.type ? `entity ${index} (type "${placement.type}")` : `entity ${index}`
      for (const reference of assetReferences(placement)) note(reference.reference, `${named} ${reference.where}`)
    })
    // The level's own world block names one too, and a sky that is not there
    // is exactly as invisible as a texture that is not there.
    if (typeof raw.world?.skyTexture === 'string') note(raw.world.skyTexture, "the level's world.skyTexture")

    return {
      name,
      placements: placed,
      entry: {
        file: relative,
        entities: placed.length,
        types: [...new Set(placed.map(entity => entity.type))],
        // Behaviours attached per placement rather than by the type. Without
        // this, a behaviour used only in a level reads as unreferenced.
        behaviours: [...new Set(placed.flatMap(entity => attachedNames(entity.behaviours)))],
        assets
      }
    }
  } catch (error) {
    return { name, placements: null, entry: { file: relative, error: String(error.message || error) } }
  }
}

/** One test file: its title and the level it plays, when it declares them. */
async function readTest(file, relative) {
  const entry = { file: relative }
  try {
    const loaded = await importFresh(file)
    if (loaded.name) entry.title = loaded.name
    if (loaded.level) entry.level = loaded.level
  } catch (error) {
    entry.error = String(error.message || error)
  }
  return entry
}
