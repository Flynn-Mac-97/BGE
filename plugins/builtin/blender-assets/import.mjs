/**
 * The half of Blender Assets that needs node: find Blender, stat a file, and
 * run one export.
 *
 * Imported only when `context.host` exists, so the browser never loads it.
 * Every path here is absolute; the plugin converts to and from `project/`
 * names, which is what the rest of the engine speaks.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { inSeconds } from './state.js'

const EXPORT_SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'export-glb.py')

/** The line Blender prints when it built the file, not when it merely started. */
const BUILT = 'engine-export-ok'

/**
 * Where Blender is installed, by platform. Checked in order, best version last.
 *
 * `ENGINE_BLENDER` is the whole list when it is set, not the first of it: a
 * path that does not run is a typo to report, and searching on would export
 * with a Blender nobody chose.
 */
async function candidates() {
  const said = process.env.ENGINE_BLENDER
  if (said) return [said]
  const found = ['blender']

  if (process.platform === 'win32') {
    for (const base of ['C:/Program Files/Blender Foundation', 'C:/Program Files (x86)/Blender Foundation']) {
      const versions = await fs.readdir(base).catch(() => [])
      // Sorted so a later Blender is tried after an earlier one and wins.
      for (const name of versions.sort()) found.push(path.join(base, name, 'blender.exe'))
    }
  } else if (process.platform === 'darwin') {
    found.push('/Applications/Blender.app/Contents/MacOS/Blender')
  } else {
    found.push('/usr/bin/blender', '/usr/local/bin/blender', '/snap/bin/blender')
  }
  return found
}

/**
 * The Blender this machine will use, or a refusal naming where it looked.
 *
 * Each candidate is asked its version rather than tested for existence: a
 * `blender` on PATH may be a wrapper, and a directory may hold an install that
 * cannot start. The version it prints is the proof it runs.
 */
export async function findBlender(host) {
  const tried = await candidates()
  let best = null
  for (const command of tried) {
    const result = await host.run(command, ['--version'], { timeout: 30000 })
    if (result.code !== 0) continue
    const version = /Blender\s+([\d.]+)/i.exec(result.out)?.[1] || 'unknown'
    best = { command, version }
  }
  if (best) return best
  if (process.env.ENGINE_BLENDER) {
    throw new Error(`ENGINE_BLENDER is set to ${process.env.ENGINE_BLENDER}, and it does not run`)
  }
  throw new Error(
    `no Blender found. Set ENGINE_BLENDER to its path, or install it. Looked at:\n  ${tried.join('\n  ')}`)
}

/** A `.blend` as it is on disk now, in the units the receipt stores. */
export async function sourceFacts(host, blend) {
  const stat = await fs.stat(path.join(host.project, blend)).catch(() => null)
  return stat ? { modified: inSeconds(stat.mtimeMs), size: stat.size } : null
}

/** Whether a project file is on disk. */
export const onDisk = (host, file) =>
  fs.stat(path.join(host.project, file)).then(() => true, () => false)

/** Every `.blend` in the project, as paths from `project/`. Dot folders skipped. */
export async function listBlends(host, directory = '', out = []) {
  const items = await fs.readdir(path.join(host.project, directory), { withFileTypes: true }).catch(() => [])
  for (const item of items) {
    if (item.name.startsWith('.')) continue
    const relative = directory ? `${directory}/${item.name}` : item.name
    if (item.isDirectory()) await listBlends(host, relative, out)
    else if (/\.blend$/i.test(item.name)) out.push(relative)
  }
  return out.sort()
}

/** One `engine-export-<name> a,b,c` line from the export script, as a list. */
const reported = (output, name) =>
  new RegExp(`engine-export-${name} (.+)`).exec(output)?.[1].trim().split(',').filter(Boolean) || []

/** The last lines of a program's output. What a reader needs to see a failure. */
const tail = (text, lines = 12) =>
  String(text || '').trimEnd().split('\n').slice(-lines).join('\n')

/**
 * Run one export. Returns what the receipt records.
 *
 * Blender exits 0 after printing an error often enough that the exit code
 * alone is not proof, so the export script prints a line on success and this
 * checks for it and for the file.
 */
export async function runExport(host, { blender, blend, model, graphs, settings }) {
  const absoluteModel = path.join(host.project, model)
  await fs.mkdir(path.dirname(absoluteModel), { recursive: true })

  const args = [
    path.join(host.project, blend),
    '--background',
    '--python', EXPORT_SCRIPT,
    '--', absoluteModel, JSON.stringify(settings), path.join(host.project, graphs)
  ]
  const result = await host.run(blender.command, args)
  const built = result.out.includes(BUILT) && await onDisk(host, model)
  if (!built) {
    throw new Error(
      `Blender could not export ${blend}:\n${tail(result.error) || tail(result.out) || 'no output'}`)
  }

  // What the export could not carry is reported, not left in the log: a
  // material that exported as flat grey looks like a texture that failed to
  // load, and nothing else says which material it was.
  const list = name => reported(result.out, name)

  const source = await sourceFacts(host, blend)
  return {
    source: path.basename(blend), ...source, settings, blender: blender.version, model,
    dropped: list('dropped'), baked: list('baked'), procedural: list('procedural'),
    scaled: list('scaled'), occluded: list('occluded'), graphs: list('graphs')
  }
}

const INSPECT_SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'inspect-blend.py')

/**
 * What a .blend holds, read by Blender itself: each character's armature,
 * meshes and height, and the `collection` setting that exports only it.
 */
export async function inspectBlend(host, blender, blend) {
  const result = await host.run(blender.command, [path.join(host.project, blend), '--background', '--python', INSPECT_SCRIPT], { timeout: 120000 })
  const line = /engine-inspect (.+)/.exec(result.out)?.[1]
  if (!line) throw new Error(`Blender could not read ${blend}:\n${tail(result.error) || tail(result.out) || 'no output'}`)
  return { file: blend, ...JSON.parse(line) }
}
