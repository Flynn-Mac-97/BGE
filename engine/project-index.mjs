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
  const index = { types: {}, behaviours: {}, levels: {}, tests: {}, assets: {}, config: [], warnings: [] }
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
        // Every way a type can name a file, in one place. `sprite` is a string
        // when simple and an object when detailed, and an object may point at a
        // single `image` or a `sheet` — miss any of these and "used by" quietly
        // goes empty, which reads as "nothing uses this, safe to delete".
        const image = typeof loaded.sprite === 'string'
          ? loaded.sprite
          : (loaded.sprite?.sheet || loaded.sprite?.image)
        entry.uses = [image, loaded.model, ...Object.values(loaded.sounds || {})]
          .filter(v => typeof v === 'string')
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
        index.levels[name] = {
          file: f,
          entities: placed.length,
          types: [...new Set(placed.map(e => e.type))],
          // Behaviours attached per placement rather than by the type. Without
          // this, a behaviour used only in a level reads as unreferenced.
          behaviours: [...new Set(placed.flatMap(e => attachedNames(e.behaviours)))]
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
  for (const [tn, t] of Object.entries(index.types)) {
    for (const u of t.uses) if (index.assets[u]) index.assets[u].usedBy.push(tn)
    for (const bn of t.behaviours || []) if (index.behaviours[bn]) index.behaviours[bn].usedBy.push(tn)
  }
  for (const [ln, l] of Object.entries(index.levels)) {
    for (const tn of l.types || []) if (index.types[tn]) index.types[tn].inLevels++
    for (const bn of l.behaviours || []) if (index.behaviours[bn]) index.behaviours[bn].usedBy.push(ln)
  }

  await fs.mkdir(path.join(projectDirectory, '.engine'), { recursive: true })
  await fs.writeFile(path.join(projectDirectory, '.engine/index.json'), JSON.stringify(index, null, 2))
  return index
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
 * Everything wrong with the project right now.
 *
 * The same list `/api/check` returns, built here so it is available with no
 * server running. An empty list is the only clean answer.
 */
export function problemsIn(index) {
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
    ...Object.entries(index.tests).filter(([, t]) => t.error)
      .map(([name, t]) => ({ file: t.file, why: `test "${name}" failed to load — ${t.error}` })),
    ...index.warnings
  ]
}
