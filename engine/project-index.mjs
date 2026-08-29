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
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export const HOOKS = ['start', 'update', 'onCollide', 'onDestroy']

export const KIND = f =>
  f.startsWith('types/')  ? 'type'
  : f.startsWith('behaviours/') ? 'behaviour'
  : f.startsWith('levels/') ? 'level'
  : f.startsWith('tests/') ? 'test'
  : /\.(png|jpg|jpeg|webp|gif|svg)$/i.test(f) ? 'image'
  : /\.(wav|mp3|ogg)$/i.test(f) ? 'sound'
  : /\.(glb|gltf)$/i.test(f) ? 'model'
  : 'config'

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
 * Where a named asset actually lives, as a path relative to `project/`.
 *
 * THIS MUST AGREE WITH `assetURL` IN `engine/ui.js`, which is the rule the
 * running engine fetches by. It is copied rather than imported because that file
 * is the browser's and this one is node's, and the moment the two disagree
 * `check` starts swearing a file is there that the renderer cannot fetch — or,
 * worse, reporting two hundred missing assets that are all sitting on disk.
 *
 * The rule: strip a leading `project/`, then a path that starts with one of the
 * project's own folders is project-relative and anything else — subfolder
 * included — lives under `assets/`.
 */
const PROJECT_FOLDER = /^(assets|levels|types|behaviours|tests|plugins)\//

export const assetPath = reference => {
  const rel = String(reference).replace(/^\/?project\//, '')
  return PROJECT_FOLDER.test(rel) ? rel : 'assets/' + rel
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

/**
 * A changing query so a re-import sees the file as it is now.
 *
 * Node caches a module by URL for the life of the process, and both the dev
 * server and a long-running headless session rebuild the index after a write —
 * without this they would keep reporting the version they first read.
 */
let readCount = 0
const importFresh = async abs => (await import(pathToFileURL(abs).href + '?read=' + ++readCount)).default || {}

/**
 * Build the index — the one artifact both the browser UI and the AI read.
 * Types are imported rather than parsed so `properties` and asset references
 * are exact.
 */
export async function buildIndex(projectDirectory) {
  const files = await walk(projectDirectory)
  // Every file in the project, by its path from `project/`. `assets` is keyed by
  // basename and so cannot answer "is this exact file there" — two folders may
  // hold a `jump.wav` — and that question is the one the asset check asks.
  const index = { types: {}, behaviours: {}, levels: {}, tests: {}, assets: {}, files, config: [], warnings: [] }
  const inside = f => path.join(projectDirectory, f)

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

  await fs.mkdir(path.join(projectDirectory, '.engine'), { recursive: true })
  await writeAtomic(path.join(projectDirectory, '.engine/index.json'), JSON.stringify(index, null, 2))

  // The agent view: the same map, minus what the editor alone acts on (the
  // file lists, per-level asset tables, reverse references). This is the file
  // the instructions tell an agent to read first — the full index is several
  // times larger for nothing an agent does.
  const agent = {
    types: Object.fromEntries(Object.entries(index.types).map(([name, t]) => [name, {
      file: t.file, properties: t.properties, hooks: t.hooks,
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
  const temporary = `${file}.${process.pid}.tmp`
  try {
    await fs.writeFile(temporary, text)
    await fs.rename(temporary, file)
  } catch (error) {
    await fs.rm(temporary, { force: true })
    throw error
  }
}

/** Every attachment, from a type or a level, that names a behaviour file that is not there. */
export function missingAttachments(index) {
  const out = []
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
  // Nothing to compare against is not the same as nothing missing, and quietly
  // passing would be exactly the silence this check exists to break.
  if (!onDisk.size) {
    return [{ file: 'project/.engine/index.json', why: 'the index carries no file list, so no asset reference could be checked — rebuild it with `node bin/engine.mjs index`' }]
  }

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
      } else if (!index.types[type]) {
        out.push({ file: l.file, why: `level "${name}" places type "${type}" — there is no project/types/${type}.js, so those placements are empty` })
      }
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
 * Everything wrong with the project right now.
 *
 * The same list `/api/check` returns, built here so it is available with no
 * server running. An empty list is the only clean answer.
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
    ...assetSummary(missing),
    ...missing,
    ...Object.entries(index.tests).filter(([, t]) => t.error)
      .map(([name, t]) => ({ file: t.file, why: `test "${name}" failed to load — ${t.error}` })),
    ...index.warnings
  ]
}
