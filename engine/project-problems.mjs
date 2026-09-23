/**
 * The problems `check` reports, and the plugin imports behind them.
 *
 * Split from `project-index.mjs` so a route that only builds the index — the
 * `index` route, a world boot, a write — never loads the checker. The index
 * carries the facts; this reads them and says what is wrong.
 *
 * Node only: it reads files and spawns `node --check`.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { assetPath, PROJECT_PREFIX } from './asset-path.js'
import { recordModuleSources } from './project-index.mjs'

/** Bumped per plugin import, so a re-import is not served from the module cache. */
let importCount = 0

/** Every attachment, from a type or a level, that names a behaviour file that is not there. */
export function missingAttachments(index) {
  const out = []
  /** Push one problem for each name that has no behaviour file. */
  const check = (names, file, where) => {
    for (const n of names || []) {
      if (!index.behaviours[n])
        out.push({ file, why: `${where} attaches behaviour "${n}" — no project/behaviours/${n}.js` })
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
    return [
      {
        file: `${PROJECT_PREFIX}/.engine/index.json`,
        why: 'the index carries no file list, so no asset reference could be checked — rebuild it with `node bin/engine.mjs index`'
      }
    ]
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
        out.push({
          file: l.file,
          why: `level "${name}" places type "${type}" — there is no project/types/${type}.js, so those placements are empty`
        })
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
  return [
    {
      file: files.length === 1 ? files[0] : 'project',
      why:
        missing.length === 1
          ? `one missing asset, in ${where}${named} — it is the next line`
          : `${missing.length} missing assets, in ${where}${named} — every one is listed below`
    }
  ]
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
  // Every plugin this is about to import is a source the guide check would
  // otherwise read a second time. Record what the loader reads so it can skip
  // that read; see `loadedModuleSource`.
  recordModuleSources()
  const places = [
    { directory: path.join(checkout, 'plugins/builtin'), builtin: true },
    { directory: path.join(projectDirectory, 'plugins'), builtin: false }
  ]
  const out = []
  for (const { directory, builtin } of places) {
    let names
    try {
      names = await fs.readdir(directory)
    } catch {
      continue
    }
    for (const name of names.filter(fileName => fileName.endsWith('.js')).sort()) {
      const file = path.join(directory, name)
      const said = path.relative(checkout, file).split(path.sep).join('/')
      const href = pathToFileURL(file).href
      try {
        // One broken plugin must not hide the next one, so every file is tried
        // and every failure is collected rather than thrown.
        const loaded = await import(href + '?plugin=' + ++importCount)
        if (!loaded.default) {
          out.push({
            name: null,
            file: said,
            builtin,
            failedToImport: false,
            noDefaultExport: true,
            error: 'no default export'
          })
        }
      } catch (error) {
        // Where it broke, which is the first thing anybody wants. A file that
        // threw while running says so in its stack; a file that would not parse
        // says nothing at all, because node keeps the position of a module
        // syntax error out of the error object — so ask for it separately.
        const frame = String(error?.stack || '')
          .split('\n')
          .map(line => line.trim())
          .find(line => line.includes(href))
        const line = Number(frame?.match(/:(\d+)(?::\d+)?\)?$/)?.[1]) || syntaxErrorLine(file)
        out.push({
          name: null,
          file: said,
          builtin,
          failedToImport: true,
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
export const pluginProblems = failures =>
  failures.map(failure => ({
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
    execFileSync(process.execPath, ['--check', file], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    return null
  } catch (error) {
    return (
      Number(
        String(error.stderr || '')
          .split('\n')[0]
          ?.match(/:(\d+)\s*$/)?.[1]
      ) || null
    )
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
        why:
          field === 'about'
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
 * Every record of one kind that failed to load, as a problem naming it.
 *
 * A type and a behaviour carry the loader's own message; a level carries the
 * parser's. `reason` is the half of the sentence that differs.
 */
function failedRecords(records, label, reason) {
  return Object.entries(records)
    .filter(([, record]) => record.error)
    .map(([name, record]) => ({ file: record.file, why: `${label} "${name}" ${reason} — ${record.error}` }))
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
    ...failedRecords(index.types, 'type', 'failed to load'),
    ...failedRecords(index.behaviours, 'behaviour', 'failed to load'),
    ...failedRecords(index.levels, 'level', 'is not valid JSON'),
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
    ...Object.entries(index.tests)
      .filter(([, t]) => t.error)
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
