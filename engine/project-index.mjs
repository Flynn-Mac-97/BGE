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
import { mkdirSync, openSync, closeSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { assetPath, PROJECT_PREFIX } from './asset-path.js'

/** The checkout this module was loaded from. The engine's own plugins are here. */
const CHECKOUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// Where a named asset lives is the one rule this file shares with the browser,
// so it is imported from the pure module both halves may import rather than
// copied. Not re-exported: a second door onto one rule is how the copies
// started.

export const HOOKS = ['start', 'update', 'onCollide', 'onDestroy']

/** The kind of thing a project file is, from its folder and extension. */
export const KIND = f =>
  f.startsWith('types/')  ? 'type'
  : f.startsWith('behaviours/') ? 'behaviour'
  : f.startsWith('levels/') ? 'level'
  : f.startsWith('tests/') ? 'test'
  : /\.(png|jpg|jpeg|webp|gif|svg)$/i.test(f) ? 'image'
  : /\.(wav|mp3|ogg)$/i.test(f) ? 'sound'
  : /\.(glb|gltf)$/i.test(f) ? 'model'
  : 'config'

/** Every file under a directory, as paths relative to it. A directory that will not read yields nothing. */
export async function walk(directory, base = '') {
  const out = []
  let items = []
  try { items = await fs.readdir(directory, { withFileTypes: true }) } catch { return out }
  for (const it of items) {
    if (it.name.startsWith('.')) continue
    const rel = base ? `${base}/${it.name}` : it.name
    if (it.isDirectory()) out.push(...await walk(path.join(directory, it.name), rel))
    else out.push(rel)
  }
  return out
}

/**
 * Reaching around the engine's clock, random stream or scheduler.
 *
 * Each of these makes a run unrepeatable, which quietly breaks `simulate()` —
 * the thing the whole change-run-compare loop rests on. They are reported
 * rather than blocked: it is the author's project, but nobody should discover
 * this by watching two identical runs disagree.
 */
const BANNED = [
  [/\bperformance\s*\.\s*now\s*\(/, 'performance.now() is the wall clock — use context.time'],
  [/\bDate\s*\.\s*now\s*\(/, 'Date.now() is the wall clock — use context.time'],
  [/\bnew\s+Date\s*\(/, 'new Date() is the wall clock — use context.time'],
  [/\bMath\s*\.\s*random\s*\(/, 'Math.random() cannot be replayed — use context.random()'],
  [/\bsetTimeout\s*\(/, 'setTimeout runs on the wall clock — use context.after(seconds, fn)'],
  [/\bsetInterval\s*\(/, 'setInterval runs on the wall clock — use context.every(seconds, fn)'],
  [/\brequestAnimationFrame\s*\(/, 'requestAnimationFrame does not run in a hidden tab — use the update hook']
]

/** Report determinism problems in one file, with line numbers. */
export function lint(file, text) {
  const out = []
  text.split('\n').forEach((line, i) => {
    if (/^\s*(\/\/|\*)/.test(line)) return          // a comment may name them
    for (const [re, why] of BANNED) {
      if (re.test(line)) out.push({ file, line: i + 1, why, code: line.trim().slice(0, 80) })
    }
  })
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
  const add = (value, where) => { if (typeof value === 'string' && value.trim()) out.push({ reference: value, where }) }
  if (!source || typeof source !== 'object') return out

  // `sprite` is a string when simple and an object when detailed, and the object
  // may point at a single `image` or at a `sheet`.
  if (typeof source.sprite === 'string') add(source.sprite, 'sprite')
  else if (source.sprite) { add(source.sprite.sheet, 'sprite.sheet'); add(source.sprite.image, 'sprite.image') }

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
export const attachedNames = v =>
  !v ? []
  : Array.isArray(v) ? v.filter(n => typeof n === 'string')
  : Object.entries(v).filter(([, config]) => config !== false).map(([n]) => n)

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
 * business running forty of them to learn one string. Being a regex is safe here
 * in the one direction that matters: a registration written some other way is
 * missed and the old false report comes back, which is exactly today's
 * behaviour, and nothing is ever wrongly called present.
 */
async function typesRegisteredByPlugins(projectDirectory, checkout) {
  const found = new Set()
  const folders = [
    path.join(checkout, 'plugins/builtin'),
    path.join(projectDirectory, 'plugins')
  ]
  for (const folder of folders) {
    const names = (await walk(folder)).filter(name => name.endsWith('.js'))
    // Read together rather than one at a time. This is 127 files and 1.3 MB in
    // the checkout, no read depends on another, and together they were most of
    // what one rebuild cost — 26 ms against 5 ms. A file that cannot be read is
    // skipped, exactly as before.
    const texts = await Promise.all(names.map(async name => {
      try { return await fs.readFile(path.join(folder, name), 'utf8') } catch { return '' }
    }))
    for (const text of texts) {
      for (const match of text.matchAll(/\bretype\s*\(\s*['"`]([\w-]+)['"`]/g)) found.add(match[1])
    }
  }
  return [...found].sort()
}

/**
 * Build the index — the one artifact both the browser UI and the AI read.
 * Types are imported rather than parsed so `properties` and asset references
 * are exact.
 */
export async function buildIndex(projectDirectory, checkout = CHECKOUT) {
  const files = await walk(projectDirectory)
  // Every file in the project, by its path from `project/`. `assets` is keyed by
  // basename and so cannot answer "is this exact file there" — two folders may
  // hold a `jump.wav` — and that question is the one the asset check asks.
  const index = {
    types: {}, behaviours: {}, levels: {}, tests: {}, assets: {}, files, config: [], warnings: [],
    pluginTypes: await typesRegisteredByPlugins(projectDirectory, checkout)
  }
  /** One project file by its path from the project directory. */
  const inside = f => path.join(projectDirectory, f)

  // Raw placements, kept only for the invariant pass below and never written
  // to `index`: a level of nine hundred entities copied onto the index would
  // double what `.engine/index.json` costs to write and read on every check,
  // for data only this one pass needs.
  const levelPlacements = {}

  for (const f of files) {
    const kind = KIND(f)

    // Every hand-written JS file in the project runs inside the fixed step, so
    // every one of them is held to the determinism rules.
    if (f.endsWith('.js')) {
      index.warnings.push(...lint(f, await fs.readFile(inside(f), 'utf8')))
    }

    if (kind === 'type') {
      const name = path.basename(f, '.js')
      const entry = { file: f, properties: [], uses: [], inLevels: 0 }
      try {
        const loaded = await importFresh(inside(f))
        entry.properties = Object.keys(loaded.properties || {})
        // Every way a type can name a file — see assetReferences, which the
        // level placements go through too. Miss any of these and "used by"
        // quietly goes empty, which reads as "nothing uses this, safe to
        // delete", and a missing file goes unreported by `check`.
        const references = assetReferences(loaded)
        entry.uses = references.map(r => r.reference)
        // Which key named which file, so a missing one can be reported with the
        // line the author would have to go and fix.
        entry.usesBy = Object.fromEntries(references.map(r => [r.reference, r.where]))
        entry.hooks = HOOKS.filter(h => typeof loaded[h] === 'function')
        // What the author says this type is, how a correct one reads on screen,
        // and how a broken one reads. Carried here so reading the index answers
        // "what is a brush" with no call and no guess from the name.
        if (loaded.about) entry.about = String(loaded.about)
        if (loaded.appearance) entry.appearance = String(loaded.appearance)
        if (loaded.looksWrongWhen) entry.looksWrongWhen = String(loaded.looksWrongWhen)
        // A rule `check` enforces against every placement of this type. Kept
        // beside `about`/`appearance` because it is the same kind of fact —
        // written once next to the type, read by every level that places it.
        // `meshBox`/`colliderBox` are the type's own defaults, stored only
        // when an invariant is declared, so a type that never opts in pays
        // nothing: see `placedHeight` below for why both are needed.
        if (loaded.invariant) {
          entry.invariant = loaded.invariant
          if (Array.isArray(loaded.mesh?.box)) entry.meshBox = loaded.mesh.box
          if (Array.isArray(loaded.collider?.box)) entry.colliderBox = loaded.collider.box
        }
        // A tint on a type multiplies into every textured placement that did not
        // state its own — see `tintProblems`, which is the only reader.
        if (loaded.mesh?.tint != null) entry.meshTint = loaded.mesh.tint
        if (loaded.animation) entry.animation = Object.keys(loaded.animation)
        // What this type composes. Listed here so "what does a crate do" is one
        // index lookup rather than opening the type and then every behaviour.
        const attached = attachedNames(loaded.behaviours)
        if (attached.length) entry.behaviours = attached
      } catch (e) {
        entry.error = String(e.message || e)
      }
      index.types[name] = entry
    }

    else if (kind === 'behaviour') {
      const name = path.basename(f, '.js')
      const entry = { file: f, properties: {}, hooks: [], usedBy: [] }
      try {
        const loaded = await importFresh(inside(f))
        // Values, not just keys, unlike a type. A behaviour is attached from a
        // list without ever opening it, so its defaults have to be readable
        // from here or nobody knows what they are agreeing to.
        entry.properties = loaded.properties || {}
        entry.hooks = HOOKS.filter(h => typeof loaded[h] === 'function')
        if (loaded.about) entry.about = String(loaded.about)
      } catch (e) {
        entry.error = String(e.message || e)
      }
      index.behaviours[name] = entry
    }

    else if (kind === 'level') {
      const name = path.basename(f, '.json')
      try {
        const raw = JSON.parse(await fs.readFile(inside(f), 'utf8'))
        const placed = raw.entities || []
        levelPlacements[name] = placed

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
        placed.forEach((placement, at) => {
          const named = placement?.type ? `entity ${at} (type "${placement.type}")` : `entity ${at}`
          for (const r of assetReferences(placement)) note(r.reference, `${named} ${r.where}`)
        })
        // The level's own world block names one too, and a sky that is not there
        // is exactly as invisible as a texture that is not there.
        if (typeof raw.world?.skyTexture === 'string') note(raw.world.skyTexture, 'the level\'s world.skyTexture')

        index.levels[name] = {
          file: f,
          entities: placed.length,
          types: [...new Set(placed.map(e => e.type))],
          // Behaviours attached per placement rather than by the type. Without
          // this, a behaviour used only in a level reads as unreferenced.
          behaviours: [...new Set(placed.flatMap(e => attachedNames(e.behaviours)))],
          assets
        }
      } catch (e) {
        index.levels[name] = { file: f, error: String(e.message || e) }
      }
    }

    else if (kind === 'test') {
      const name = path.basename(f, '.js')
      const entry = { file: f }
      try {
        const loaded = await importFresh(inside(f))
        if (loaded.name) entry.title = loaded.name
        if (loaded.level) entry.level = loaded.level
      } catch (e) {
        entry.error = String(e.message || e)
      }
      index.tests[name] = entry
    }

    else if (kind === 'config') index.config.push(f)
    else index.assets[path.basename(f)] = { file: f, kind, usedBy: [] }
  }

  // relationships: assets -> types that reference them, types -> levels that place them
  // Matched on the resolved path, not on the reference as written: an asset in a
  // subfolder is named `counter-strike/wall.png` and filed under `wall.png`, so
  // looking it up by the reference found nothing and every subfolder asset read
  // as unused — which reads as "safe to delete".
  const assetByPath = new Map(Object.values(index.assets).map(a => [a.file, a]))
  /** The asset entry a reference resolves to, or undefined when no file is there. */
  const assetFor = reference => assetByPath.get(assetPath(reference))

  for (const [tn, t] of Object.entries(index.types)) {
    for (const u of t.uses || []) assetFor(u)?.usedBy.push(tn)
    for (const bn of t.behaviours || []) if (index.behaviours[bn]) index.behaviours[bn].usedBy.push(tn)
  }
  for (const [ln, l] of Object.entries(index.levels)) {
    for (const tn of l.types || []) if (index.types[tn]) index.types[tn].inLevels++
    for (const bn of l.behaviours || []) if (index.behaviours[bn]) index.behaviours[bn].usedBy.push(ln)
    for (const reference of Object.keys(l.assets || {})) assetFor(reference)?.usedBy.push(ln)
  }

  // Every type is loaded by this point; a level can be walked before the type
  // it places, so checking placements while `index.types` is still filling in
  // would miss a type read later and silently pass every placement of it.
  index.invariantProblems = invariantProblems(index, levelPlacements)
  index.tintProblems = tintProblems(index, levelPlacements)

  await fs.mkdir(path.join(projectDirectory, '.engine'), { recursive: true })
  await writeAtomic(path.join(projectDirectory, '.engine/index.json'), JSON.stringify(index, null, 2))

  // The agent view: the same map, minus what the editor alone acts on (the
  // file lists, per-level asset tables, reverse references). This is the file
  // the instructions tell an agent to read first — the full index is several
  // times larger for nothing an agent does.
  const agent = {
    types: Object.fromEntries(Object.entries(index.types).map(([name, t]) => [name, {
      file: t.file,
      ...(t.about ? { about: t.about } : {}),
      ...(t.appearance ? { appearance: t.appearance } : {}),
      ...(t.looksWrongWhen ? { looksWrongWhen: t.looksWrongWhen } : {}),
      ...(t.invariant ? { invariant: t.invariant } : {}),
      properties: t.properties, hooks: t.hooks,
      ...(t.uses?.length ? { uses: t.uses } : {}),
      ...(t.behaviours?.length ? { behaviours: t.behaviours } : {}),
      ...(t.error ? { error: t.error } : {})
    }])),
    behaviours: Object.fromEntries(Object.entries(index.behaviours).map(([name, b]) => [name, {
      file: b.file, about: b.about, properties: b.properties, hooks: b.hooks,
      ...(b.error ? { error: b.error } : {})
    }])),
    levels: Object.fromEntries(Object.entries(index.levels).map(([name, l]) => [name, {
      file: l.file, entities: l.entities, types: l.types, behaviours: l.behaviours,
      ...(l.error ? { error: l.error } : {})
    }])),
    tests: Object.fromEntries(Object.entries(index.tests).map(([name, t]) => [name, {
      file: t.file,
      ...(t.title ? { title: t.title } : {}),
      ...(t.level ? { level: t.level } : {}),
      ...(t.error ? { error: t.error } : {})
    }])),
    // Keyed by path, not basename, so "what kind is this file" is an exact
    // lookup rather than a guess across folders.
    assets: Object.fromEntries(Object.values(index.assets).map(a => [a.file, a.kind]))
  }
  await writeAtomic(path.join(projectDirectory, '.engine/index.agent.json'), JSON.stringify(agent, null, 2))
  return index
}

/** A counter making each atomic write's temporary name unique within this process. */
let writeCount = 0

/**
 * Write a whole file, or none of it.
 *
 * The index is rebuilt by every boot, every save and every `check`, so several
 * agents in one checkout write it at the same time as a matter of course. A
 * plain writeFile lets one of them read the half a neighbour had written, and
 * a torn index fails `check` against files nobody touched — the reader is
 * blamed for the writer's race.
 *
 * Rename is atomic on one filesystem, so a reader sees the whole old file or
 * the whole new one. There is no lock, and there should not be: the index is
 * derived from disk, so two writers racing both produce the same bytes and
 * last-one-wins is the right answer. The run registry next door does take a
 * lock, because it accumulates rather than derives.
 */
async function writeAtomic(file, text) {
  // The pid is not enough on its own. One process rebuilds the index on every
  // save, and two of those overlap the moment saves come faster than a write —
  // they would then share a temporary name, and the second rename would find
  // the first had already moved it away.
  const temporary = `${file}.${process.pid}.${++writeCount}.tmp`
  try {
    await fs.writeFile(temporary, text)
    await renameWhenAllowed(temporary, file)
  } catch (error) {
    await fs.rm(temporary, { force: true })
    throw error
  }
}

/**
 * Rename, allowing for a reader that has the destination open.
 *
 * Windows refuses a rename onto a file another process is reading, and the
 * index is read by every `check`, every agent and every editor boot — so a busy
 * checkout meets EPERM as a matter of course. It clears in milliseconds. The
 * only wrong answer is to treat the first refusal as final, because the caller
 * is usually a file watcher and a throw there ends the whole dev server.
 *
 * A plain timer, not `context.after`: this is build tooling in node, running
 * outside any world, and there is no fixed clock here to be deterministic on.
 */
async function renameWhenAllowed(from, to, tries = 5) {
  const BUSY = new Set(['EPERM', 'EBUSY', 'EACCES'])
  for (let attempt = 1; ; attempt++) {
    try { return await fs.rename(from, to) } catch (error) {
      if (attempt >= tries || !BUSY.has(error.code)) throw error
      await new Promise(resolve => setTimeout(resolve, attempt * 20))
    }
  }
}

/** Every attachment, from a type or a level, that names a behaviour file that is not there. */
export function missingAttachments(index) {
  const out = []
  /** Push one problem for each name that has no behaviour file. */
  const check = (names, file, where) => {
    for (const n of names || []) {
      if (!index.behaviours[n]) out.push({ file, why: `${where} attaches behaviour "${n}" — no project/behaviours/${n}.js` })
    }
  }
  for (const [name, t] of Object.entries(index.types)) check(t.behaviours, t.file, `type "${name}"`)
  for (const [name, l] of Object.entries(index.levels)) check(l.behaviours, l.file, `level "${name}"`)
  return out
}

/**
 * Every asset a type or a level names that is not a file on disk.
 *
 * This is the check whose absence shipped a whole map broken. `check` validated
 * that types loaded, that levels parsed and that behaviours existed, and never
 * once asked whether the two hundred textures the level named were there — so a
 * map with 231 unresolvable references passed clean, and the only symptom was a
 * viewport full of untextured grey.
 *
 * Reported once per file-and-reference with a count, because a map names the
 * same texture forty times and forty identical lines are worse than one.
 */
export function missingAssets(index) {
  const onDisk = new Set(index.files || [])
  const out = []

  // `references` is how many times the file names it, so the summary can say
  // "4 missing assets, named 231 times" rather than leaving the two confused.
  const missing = (reference, file, references, said) => {
    const resolved = assetPath(reference)
    if (onDisk.has(resolved)) return
    out.push({ file, reference, references, why: `${said} — there is no project/${resolved}` })
  }

  for (const [name, t] of Object.entries(index.types)) {
    for (const reference of t.uses || []) {
      const where = t.usesBy?.[reference]
      missing(reference, t.file, 1, `type "${name}" names "${reference}"${where ? ` as ${where}` : ''}`)
    }
  }

  for (const [name, l] of Object.entries(index.levels)) {
    for (const [reference, use] of Object.entries(l.assets || {})) {
      const times = use.count === 1 ? 'once' : `${use.count} times`
      missing(reference, l.file, use.count, `level "${name}" names "${reference}" ${times}, first at ${use.first}`)
    }
  }

  // A file list that is empty because the project is empty is a true answer;
  // one that is empty while something names an asset means the index was never
  // built, and every reference would be reported as absent.
  if (!onDisk.size && out.length) {
    return [{
      file: `${PROJECT_PREFIX}/.engine/index.json`,
      why: 'the index carries no file list, so no asset reference could be checked — rebuild it with `node bin/engine.mjs index`'
    }]
  }
  return out
}

/**
 * Every type a placement names that has no file.
 *
 * A level naming a type that was deleted, or misspelled, places nothing — no
 * mesh, no collider, nothing in the viewport — and said nothing about it. In a
 * 281-entity map one mistyped name is invisible by eye.
 */
export function missingTypes(index) {
  const out = []
  for (const [name, l] of Object.entries(index.levels)) {
    for (const type of l.types || []) {
      if (typeof type !== 'string' || !type.trim()) {
        out.push({ file: l.file, why: `level "${name}" has a placement with no "type" — it will place nothing` })
      } else if (!index.types[type] && !(index.pluginTypes || []).includes(type)) {
        out.push({ file: l.file, why: `level "${name}" places type "${type}" — there is no project/types/${type}.js, so those placements are empty` })
      }
    }
  }
  return out
}

/**
 * The drawn height of one placement, along the same rule engine/world.js's
 * `makeEntity` uses to build the real entity: a placement's `mesh` merges
 * over the type's key by key, so its box wins only when it states one, but a
 * placement's `collider` REPLACES the type's outright — a placement that
 * gives a collider with no box has no box at all, even if the type had one.
 * Returns null when neither the placement nor its type says a height.
 */
function placedHeight(type, placement) {
  const meshBox = Array.isArray(placement.mesh?.box) ? placement.mesh.box : type.meshBox
  const colliderBox = placement.collider
    ? (Array.isArray(placement.collider.box) ? placement.collider.box : undefined)
    : type.colliderBox
  const height = meshBox?.[1] ?? colliderBox?.[1]
  return Number.isFinite(height) ? height : null
}

/**
 * Named invariant rules a type may declare. Each takes the declared invariant,
 * the type's index entry and one raw placement, and returns `{ expected,
 * actual }` to compare, or null when this placement carries too little to
 * check — never a silent pass.
 *
 * `topFaceAtY`: a box centred at `at[1]` with height h has its top face at
 * `at[1] + h/2`. This is the rule kitten-survivors/types/ground.js states in
 * its own doc comment — the top face of the slab is the y = 0 plane every
 * other position in the level is measured from.
 */
const INVARIANT_RULES = {
  topFaceAtY: (declared, type, placement) => {
    const y = placement?.at?.[1]
    const height = placedHeight(type, placement)
    if (!Number.isFinite(y) || height == null) return null
    return { expected: declared.value, actual: y + height / 2 }
  }
}

/**
 * Every placement that breaks the invariant its type declares.
 *
 * Takes `levelPlacements` rather than reading it off `index`, because raw
 * placements are not kept on the index — see the comment where `buildIndex`
 * collects them. A level whose file failed to parse has no placements to
 * check and is skipped; `missingTypes` already reports a placement naming a
 * type that does not exist, so this only runs for placements whose type is
 * real.
 *
 * An unrecognised rule name and a placement `check` cannot compute from are
 * both reported as warnings — an invariant `check` cannot evaluate must say
 * so, not read as one that passed.
 */
export function invariantProblems(index, levelPlacements) {
  const out = []
  for (const [levelName, placements] of Object.entries(levelPlacements || {})) {
    const level = index.levels[levelName]
    if (!level || level.error) continue

    placements.forEach((placement, at) => {
      const typeName = placement?.type
      const type = typeName && index.types[typeName]
      const declared = type?.invariant
      if (!declared) return

      const named = `level "${levelName}" placement "${placement.id ?? `#${at}`}" (type "${typeName}")`
      const rule = INVARIANT_RULES[declared.rule]
      if (!rule) {
        out.push({
          file: type.file, warning: true,
          why: `type "${typeName}" declares invariant rule "${declared.rule}", which check does not know how to enforce`
        })
        return
      }

      const result = rule(declared, type, placement)
      if (!result || !Number.isFinite(result.expected) || !Number.isFinite(result.actual)) {
        out.push({
          file: level.file, warning: true,
          why: `${named} cannot be checked against its invariant "${declared.rule}" — not enough on the placement or its type to compute it`
        })
        return
      }

      const tolerance = Number.isFinite(declared.tolerance) ? declared.tolerance : 1e-6
      if (Math.abs(result.actual - result.expected) > tolerance) {
        out.push({
          file: level.file,
          why: `${named} breaks its invariant${declared.about ? ` — ${declared.about}` : ''} — expected ${result.expected}, got ${result.actual}`
        })
      }
    })
  }
  return out
}

/**
 * Is this tint white — the one value that multiplies nothing?
 *
 * Written as a hex string in a level and sometimes as a number in a type, so
 * both forms are read. Anything unreadable counts as not-white, because a tint
 * nobody can evaluate is exactly the one worth reporting.
 */
function tintIsWhite(tint) {
  if (typeof tint === 'number') return tint === 0xffffff
  const said = String(tint ?? '').trim().toLowerCase()
  return said === 'white' || said === '#fff' || said === '#ffffff'
}

/**
 * Every placement that draws a texture through a tint its type set.
 *
 * A placement's `mesh` merges over the type's key by key, so `tint` on a type is
 * not a fallback: it multiplies into every textured placement that did not state
 * its own. The level names no colour at all, so nothing in the file a reader
 * opens is wrong, and the only symptom is a frame that comes back the wrong
 * colour.
 *
 * A warning, not a failure. A type may be tinted on purpose, so the pair is a
 * strong smell rather than proof.
 *
 * One line per type and level with a count, the way a missing asset is reported:
 * a single type repaints hundreds of placements, and hundreds of identical lines
 * are worse than one.
 */
export function tintProblems(index, levelPlacements) {
  const out = []
  for (const [levelName, placements] of Object.entries(levelPlacements || {})) {
    const level = index.levels[levelName]
    if (!level || level.error) continue

    const hit = new Map()
    placements.forEach((placement, at) => {
      const type = index.types[placement?.type]
      if (!type || type.meshTint == null || tintIsWhite(type.meshTint)) return
      const mesh = placement?.mesh
      // A string mesh is the texture shorthand and states no tint either, so it
      // is caught by the same rule.
      const texture = typeof mesh === 'string' ? mesh : mesh?.texture
      if (!texture || (mesh && typeof mesh === 'object' && 'tint' in mesh)) return
      const seen = hit.get(placement.type)
        || { count: 0, first: placement.id ?? `#${at}`, tint: type.meshTint, typeFile: type.file }
      seen.count++
      hit.set(placement.type, seen)
    })

    for (const [typeName, seen] of hit) {
      const times = seen.count === 1 ? 'once' : `${seen.count} times`
      out.push({
        file: level.file,
        warning: true,
        why: `level "${levelName}" gives type "${typeName}" a textured mesh with no tint of its own ${times}` +
          ` (first "${seen.first}"), and the type declares mesh.tint ${JSON.stringify(seen.tint)}` +
          ` — a placement's mesh merges key by key, so that tint multiplies the texture on every one of them.` +
          ` State a tint on the placements, or take it off ${seen.typeFile}.`
      })
    }
  }
  return out
}

/**
 * One line saying how big the asset problem is, ahead of the list itself.
 *
 * "231 missing assets" and "one missing asset" are two different situations and
 * the difference is invisible in a long JSON array. An agent reading `check`
 * should learn which one it is looking at from the first line, not by counting.
 */
function assetSummary(missing) {
  if (!missing.length) return []
  const files = [...new Set(missing.map(m => m.file))]
  const where = files.length === 1 ? files[0] : `${files.length} files`
  const references = missing.reduce((total, m) => total + (m.references || 1), 0)
  // A map naming four absent textures on 231 brushes is four things to draw and
  // 231 places it shows, and both numbers are worth having.
  const named = references === missing.length ? '' : `, named ${references} times`
  return [{
    file: files.length === 1 ? files[0] : 'project',
    why: missing.length === 1
      ? `one missing asset, in ${where}${named} — it is the next line`
      : `${missing.length} missing assets, in ${where}${named} — every one is listed below`
  }]
}

/**
 * Every plugin file that will not load, found by importing it.
 *
 * A plugin whose file throws on import loses every command it registers, and
 * the only thing anybody sees is `no command "see.capture"` — the plugin's own
 * name appears nowhere, so the search starts in the wrong file. The loader has
 * to carry on past a broken plugin or one bad file would take the editor with
 * it, and that tolerance is exactly what makes the failure silent.
 *
 * Nothing about that is visible in the index, because the index never imports a
 * plugin. Finding it means trying the import, which is what this does, on the
 * same two directories and in the same order the loader reads.
 *
 * A file with no default export is the same failure wearing a different hat.
 * The loader skips it without a word, so its commands are missing just as
 * completely; a plugin directory holds plugins, and a helper module belongs in
 * a folder beneath one. It is reported with `failedToImport: false`, because
 * the file imported perfectly and was thrown away afterwards.
 *
 * The record is shaped as the running loader shapes its own — name, file,
 * error, builtin, failedToImport — so `check` can be pointed at a live
 * loader's list instead of this one without the reply changing shape. `name` is
 * always null here: a module that would not load never said what it was called.
 *
 * Deliberately not part of `buildIndex`. The index is rebuilt on every save
 * inside the dev server, and importing forty browser modules on each keystroke
 * would charge every edit for an answer only `check` asks for.
 */
export async function pluginImportFailures(checkout, projectDirectory) {
  const places = [
    { directory: path.join(checkout, 'plugins/builtin'), builtin: true },
    { directory: path.join(projectDirectory, 'plugins'), builtin: false }
  ]
  const out = []
  for (const { directory, builtin } of places) {
    let names = []
    try { names = await fs.readdir(directory) } catch { continue }
    for (const name of names.filter(name => name.endsWith('.js')).sort()) {
      const file = path.join(directory, name)
      const said = path.relative(checkout, file).split(path.sep).join('/')
      const href = pathToFileURL(file).href
      try {
        // One broken plugin must not hide the next one, so every file is tried
        // and every failure is collected rather than thrown.
        const loaded = await import(href + '?plugin=' + ++readCount)
        if (!loaded.default) {
          out.push({ name: null, file: said, builtin, failedToImport: false, noDefaultExport: true, error: 'no default export' })
        }
      } catch (error) {
        // Where it broke, which is the first thing anybody wants. A file that
        // threw while running says so in its stack; a file that would not parse
        // says nothing at all, because node keeps the position of a module
        // syntax error out of the error object — so ask for it separately.
        const frame = String(error?.stack || '').split('\n').map(line => line.trim()).find(line => line.includes(href))
        const line = Number(frame?.match(/:(\d+)(?::\d+)?\)?$/)?.[1]) || syntaxErrorLine(file)
        out.push({
          name: null, file: said, builtin, failedToImport: true,
          error: String(error?.message || error).split('\n')[0],
          ...(Number.isFinite(line) ? { line } : {})
        })
      }
    }
  }
  return out
}

/**
 * Say what a failed plugin costs, in the words `check` answers in.
 *
 * Kept apart from the finding so either source of failures — these imports, or
 * a running loader's own list — reads out the same way.
 */
export const pluginProblems = failures => failures.map(failure => ({
  file: failure.file,
  ...(Number.isFinite(failure.line) ? { line: failure.line } : {}),
  why: failure.failedToImport
    ? `plugin "${failure.file}" failed to import — ${failure.error}. Every command in it is missing until this loads.`
    : `plugin "${failure.file}" has no default export, so the loader skips it and every command it meant to register is missing`
}))

/**
 * The line a file will not parse at.
 *
 * `node --check` prints the position that a caught import error withholds. It
 * costs a child process, so it is only ever reached once a file has already
 * failed — a line number is worth a few milliseconds at exactly that moment.
 */
function syntaxErrorLine(file) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: ['ignore', 'pipe', 'pipe'] })
    return null
  } catch (error) {
    return Number(String(error.stderr || '').split('\n')[0]?.match(/:(\d+)\s*$/)?.[1]) || null
  }
}

/**
 * How long each authored description may be.
 *
 * `about` is repeated once per marked type in every See sidecar, so its cost is
 * multiplied by how many types a frame holds. The other two never enter a
 * sidecar and are held to one sentence a reader takes in at a glance.
 */
const CAPS = { about: 100, appearance: 200, looksWrongWhen: 200 }

/**
 * What nobody has written, and what somebody wrote too much of.
 *
 * Both are warnings. A check that failed the build the day it shipped, against
 * every type at once, is a check somebody switches off.
 */
function describedProblems(index) {
  const out = []
  for (const [name, type] of Object.entries(index.types)) {
    if (type.error) continue
    for (const [field, cap] of Object.entries(CAPS)) {
      const written = type[field]
      if (!written || written.length <= cap) continue
      out.push({
        file: type.file,
        warning: true,
        why: field === 'about'
          ? `type "${name}" has an about of ${written.length} characters — it is repeated once per marked type in every See sidecar, so keep it under ${cap}`
          : `type "${name}" has an ${field} of ${written.length} characters — it should read as one sentence, so keep it under ${cap}`
      })
    }
    if (!type.about) {
      out.push({
        file: type.file,
        warning: true,
        why: `type "${name}" has no about — an agent reading a level cannot say what it is`
      })
    }
  }
  return out
}

/**
 * Everything wrong with the project right now.
 *
 * The same list `/api/check` returns, built here so it is available with no
 * server running. No entry without `warning` is the only clean answer; an entry
 * marked `warning` is reported and never fails a check — see `fatal`.
 */
export function problemsIn(index) {
  const missing = missingAssets(index)
  return [
    ...Object.entries(index.types).filter(([, t]) => t.error)
      .map(([name, t]) => ({ file: t.file, why: `type "${name}" failed to load — ${t.error}` })),
    ...Object.entries(index.behaviours).filter(([, b]) => b.error)
      .map(([name, b]) => ({ file: b.file, why: `behaviour "${name}" failed to load — ${b.error}` })),
    ...Object.entries(index.levels).filter(([, l]) => l.error)
      .map(([name, l]) => ({ file: l.file, why: `level "${name}" is not valid JSON — ${l.error}` })),
    // An attachment naming a file that is not there is silent at runtime except
    // for one console line, and the symptom is an entity that simply does not
    // do the thing. Catch it here.
    ...missingAttachments(index),
    // A placement naming a type that is not there places nothing at all, and a
    // texture, model or sound that is not on disk draws as grey or plays as
    // silence. Both are invisible in a large level, and both used to pass.
    ...missingTypes(index),
    // A type's own declared rule, broken by a placement — built once, inside
    // buildIndex, because it needs every type loaded first.
    ...(index.invariantProblems || []),
    // A tint on a type multiplies the texture of every placement that did not
    // state its own, and neither file reads as wrong on its own.
    ...(index.tintProblems || []),
    ...assetSummary(missing),
    ...missing,
    ...Object.entries(index.tests).filter(([, t]) => t.error)
      .map(([name, t]) => ({ file: t.file, why: `test "${name}" failed to load — ${t.error}` })),
    ...describedProblems(index),
    ...index.warnings
  ]
}

/**
 * The problems that fail a check.
 *
 * Every caller that turns the list into a pass or a fail goes through this one
 * function, so a warning cannot be fatal in one place and advisory in another.
 */
export const fatal = problems => problems.filter(problem => !problem.warning)

// ------------------------------------------------------------------ servers
/**
 * What this checkout has running, so cleanup is one command instead of a hunt.
 *
 * A dev server and the editor tabs attached to it are what a task leaves
 * behind, and neither used to be written down anywhere. The damage is quiet: a
 * stale hidden tab answers a capture with a blank frame, and a forgotten server
 * on the expected port serves a different project, so the next agent reads the
 * wrong game and is never told which one it is reading.
 *
 * Both halves live in this module because both halves need them. The dev server
 * writes its record from `vite.config.js` and the CLI reads and stops them from
 * `bin/engine.mjs`, and those are the two files that already import this one —
 * two implementations of "which servers are there" would drift the first time
 * either half changed.
 */

/**
 * Where the record lives.
 *
 * Anchored to the MAIN worktree, exactly as the agent run registry is. A lane
 * runs in `.agent-worktrees/<id>`, so a record written there is deleted with the
 * worktree — and the servers most in need of stopping would be the ones nothing
 * remembered. The checkout's own `.engine/`, not a project's: a server belongs
 * to the checkout that started it, and the project may be any directory.
 */
export function serverRegistryFile(checkout) {
  return path.join(mainWorktreeOf(checkout), '.engine/servers.json')
}

/** The main worktree of a checkout, so a registry file survives its lane worktree being deleted. */
function mainWorktreeOf(checkout) {
  try {
    const line = execFileSync('git', ['-C', checkout, 'worktree', 'list', '--porcelain'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
      .split(/\r?\n/).find(value => value.startsWith('worktree '))
    if (line) return path.resolve(line.slice('worktree '.length))
  } catch { /* not a git checkout — this checkout is the right answer */ }
  return path.resolve(checkout)
}

/** The server records for a checkout, or an empty registry when the file is missing or broken. */
export function readServerRegistry(checkout) {
  try {
    const value = JSON.parse(readFileSync(serverRegistryFile(checkout), 'utf8'))
    return { version: 1, servers: Array.isArray(value.servers) ? value.servers : [] }
  } catch { return { version: 1, servers: [] } }
}

/** A registry edit is one read and one rename; a lock older than this is a corpse. */
const STALE_LOCK_MILLISECONDS = 60_000

/**
 * Read, change, write — under a lock, because this file accumulates rather than
 * derives. Two servers starting in the same second would otherwise each write
 * the registry they read before the other existed, and one of them would vanish.
 */
function editServerRegistry(checkout, change) {
  const file = serverRegistryFile(checkout)
  const lock = file + '.lock'
  mkdirSync(path.dirname(file), { recursive: true })
  let handle
  try {
    handle = openSync(lock, 'wx')
  } catch {
    const age = Date.now() - (statSync(lock, { throwIfNoEntry: false })?.mtimeMs ?? Date.now())
    if (age < STALE_LOCK_MILLISECONDS) throw new Error('another process is updating the server registry; retry in a moment')
    try { unlinkSync(lock) } catch { /* already gone */ }
    handle = openSync(lock, 'wx')
  }
  try {
    const registry = readServerRegistry(checkout)
    const next = change(registry) || registry
    const temporary = `${file}.${process.pid}.tmp`
    writeFileSync(temporary, JSON.stringify(next, null, 2) + '\n', 'utf8')
    renameSync(temporary, file)
    return next
  } finally {
    if (handle != null) closeSync(handle)
    try { unlinkSync(lock) } catch { /* already gone */ }
  }
}

/**
 * Write down a server that has just begun listening.
 *
 * The port is the key: one process can hold it at a time, so an older record for
 * the same port is a corpse by definition. Records whose process no longer
 * exists are dropped in the same pass, or a month of crashed servers piles up in
 * a file whose whole value is being short enough to read.
 */
export function recordServer(checkout, server) {
  return editServerRegistry(checkout, registry => ({
    ...registry,
    servers: [
      ...registry.servers.filter(entry => entry.port !== server.port && processIsAlive(entry.pid)),
      server
    ]
  }))
}

/** Forget one server, by the two facts that identify it. */
export function forgetServer(checkout, port, pid) {
  return editServerRegistry(checkout, registry => ({
    ...registry,
    servers: registry.servers.filter(entry => !(entry.port === port && entry.pid === pid))
  }))
}

/**
 * Does this process id exist at all?
 *
 * Signal 0 asks the question without sending anything, on Windows as well as
 * elsewhere. Being refused permission is still an answer: something is there.
 */
export function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try { process.kill(pid, 0); return true } catch (error) { return error.code === 'EPERM' }
}

/**
 * Which program owns a process id right now.
 *
 * The operating system hands a dead server's number to whatever starts next, so
 * "the process id in the record still exists" is not the same as "our server is
 * still there". Asking what the number belongs to is what keeps `stop` from
 * killing a stranger.
 */
function processImage(pid) {
  try {
    if (process.platform === 'win32') {
      const row = execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
      if (!row || !row.startsWith('"')) return null
      return row.slice(1).split('"')[0]
    }
    return execFileSync('ps', ['-o', 'comm=', '-p', String(pid)],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim() || null
  } catch { return null }
}

/** Whether a process image name is node, the only program a dev server starts as. */
const isNodeProcess = image => /^node(\.exe)?$/i.test(path.basename(image || ''))

/**
 * Ask a port whether an engine dev server is behind it, and what it serves.
 *
 * This is the proof. A record is a note somebody left; a reply is the server
 * saying it is here, which checkout it serves, and which tabs are attached.
 *
 * By the same name every command drives it with. A dev server binds to
 * `localhost`, which resolves to the IPv6 address first on Windows, so asking
 * `127.0.0.1` is refused by a server that is running perfectly — and a running
 * server reported dead is the one answer this must never give.
 */
async function askServer(port, milliseconds = 1500) {
  const stop = AbortSignal.timeout(milliseconds)
  try {
    const response = await fetch(`http://localhost:${port}/api/server`, { signal: stop })
    if (!response.ok) return null
    const said = await response.json()
    return typeof said?.pid === 'number' ? said : null
  } catch { return null }
}

/**
 * One server, as it really is rather than as the file remembers it.
 *
 * Four honest answers, and only the first one means "you can talk to this":
 *   running       the port answers as this exact server
 *   unresponsive  the process is there and is node, but the port says nothing
 *   replaced      something else holds the port; it is named, and never killed
 *   dead          the process is gone, or its number now belongs to another
 *                 program
 */
async function inspectServer(entry) {
  const answer = await askServer(entry.port)
  const image = processIsAlive(entry.pid) ? processImage(entry.pid) : null
  const seen = {
    ...entry,
    uptimeSeconds: Math.max(0, Math.round((Date.now() - Date.parse(entry.startedAt || 0)) / 1000)) || 0
  }

  if (answer && answer.pid === entry.pid && path.resolve(answer.serves || '') === path.resolve(entry.serves || '')) {
    return { ...seen, state: 'running', alive: true, project: answer.project ?? entry.project, tabs: describeTabs(answer.tabs) }
  }
  if (answer) {
    return {
      ...seen, state: 'replaced', alive: false,
      answering: { pid: answer.pid, serves: answer.serves, project: answer.project },
      why: `port ${entry.port} answers, but as process ${answer.pid} serving ${answer.serves} — an op sent there would read a different project. Nothing on this port is stopped for you.`
    }
  }
  if (image && isNodeProcess(image)) {
    return { ...seen, state: 'unresponsive', alive: false, why: `process ${entry.pid} is still there but port ${entry.port} answers nothing; it is either still starting or wedged` }
  }
  return {
    ...seen, state: 'dead', alive: false,
    why: image
      ? `process ${entry.pid} now belongs to ${image}, so this server is gone and its number has been reused`
      : `process ${entry.pid} is gone`
  }
}

/**
 * A hidden tab renders nothing, so a capture taken through one comes back
 * blank. It is the single most confusing failure this listing exists to
 * explain, so it is spelled out rather than left as a flag to interpret.
 */
const describeTabs = tabs => (Array.isArray(tabs) ? tabs : []).map(tab => ({
  ...tab,
  ...(tab.hidden ? { why: 'hidden — a hidden tab does not draw, so a capture taken through it comes back blank' } : {})
}))

/**
 * Every server this checkout knows about, proved one by one.
 *
 * `alsoProbe` names ports to ask about even though no record mentions them. The
 * default port belongs on that list: a server nothing wrote down, sitting where
 * every command looks by default, is the exact situation an agent cannot see.
 */
export async function listServers(checkout, alsoProbe = []) {
  const registry = readServerRegistry(checkout)
  const servers = await Promise.all(registry.servers.map(inspectServer))

  const known = new Set(registry.servers.map(entry => entry.port))
  for (const port of alsoProbe) {
    if (!Number.isInteger(port) || known.has(port)) continue
    const answer = await askServer(port)
    if (!answer) continue
    servers.push({
      port, pid: answer.pid, serves: answer.serves, project: answer.project,
      url: `http://localhost:${port}`, startedAt: answer.startedAt,
      state: 'unregistered', alive: true, tabs: describeTabs(answer.tabs),
      why: `an engine server nothing wrote down is listening on port ${port}, serving ${answer.serves}`
    })
  }

  servers.sort((left, right) => left.port - right.port)
  return {
    registry: serverRegistryFile(checkout),
    running: servers.filter(server => server.alive).length,
    servers
  }
}

/** Stop a process and the children it started, and wait for it to actually go. */
async function endProcess(pid) {
  try {
    if (process.platform === 'win32') {
      // `npm run dev` is the parent of the vite process that holds the port, so
      // the tree is killed rather than the one process — otherwise the shell is
      // left behind holding the terminal.
      execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: ['ignore', 'pipe', 'pipe'] })
    } else {
      process.kill(pid, 'SIGTERM')
    }
  } catch { /* it may have died between the check and the kill, which is a win */ }
  for (let attempt = 0; attempt < 20 && processIsAlive(pid); attempt++) {
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  return !processIsAlive(pid)
}

/**
 * Stop one server, or every one of them, and say what actually happened.
 *
 * Safe to run when nothing is running: an empty registry is an empty answer and
 * a clean exit. A server that is not ours is reported and left alone — killing
 * whatever happens to hold a port would be a worse bug than the one this fixes.
 * Records that are proved dead are cleared in the same pass, so running this
 * twice leaves nothing behind.
 */
export async function stopServers(checkout, port = null) {
  const listed = await listServers(checkout, port == null ? [] : [port])
  const targets = port == null ? listed.servers : listed.servers.filter(server => server.port === port)

  const stopped = []
  const alreadyDead = []
  const refused = []
  const forget = []

  for (const server of targets) {
    const named = { port: server.port, pid: server.pid, serves: server.serves, project: server.project }

    if (server.state === 'dead') {
      alreadyDead.push({ ...named, why: server.why })
      forget.push(server)
      continue
    }
    if (server.state === 'replaced') {
      refused.push({ ...named, why: server.why })
      forget.push(server)
      continue
    }
    if (server.state === 'unregistered' && !path.resolve(server.serves || '.').startsWith(mainWorktreeOf(checkout))) {
      refused.push({ ...named, why: `nothing here started it and it serves ${server.serves}, which is outside this checkout` })
      continue
    }

    const gone = await endProcess(server.pid)
    if (gone) {
      stopped.push({ ...named, was: server.state, tabsAttached: (server.tabs || []).length })
      forget.push(server)
    } else {
      refused.push({ ...named, why: `process ${server.pid} would not stop; stop it by hand` })
    }
  }

  if (forget.length) {
    editServerRegistry(checkout, registry => ({
      ...registry,
      servers: registry.servers.filter(entry => !forget.some(done => done.port === entry.port && done.pid === entry.pid))
    }))
  }

  return {
    registry: serverRegistryFile(checkout),
    stopped,
    alreadyDead,
    refused,
    ok: refused.length === 0
  }
}
