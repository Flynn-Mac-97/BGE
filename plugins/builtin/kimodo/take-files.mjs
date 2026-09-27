/**
 * Kimodo's node half for a take's files: delete a take from a project. Node
 * only: the page writes files but removes none.
 *
 * A take is its clip, `assets/motion/<model>/<take>.json`, and the stored
 * motion it was made from, `assets/motion/source/<take>/`. The motion goes
 * too unless another clip in the project names it, such as the same take
 * retargeted onto a second model.
 */
import fs from 'node:fs'
import path from 'node:path'

const CLIP_FILE = /^motion\/[^/]+\/[^/]+\.json$/

/** Every clip file in the project's assets/motion/, as `motion/<folder>/<name>.json`. */
function clipsIn(project) {
  const motion = path.join(project, 'assets', 'motion')
  if (!fs.existsSync(motion)) return []
  return fs
    .readdirSync(motion, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && entry.name !== 'source')
    .flatMap(folder =>
      fs
        .readdirSync(path.join(motion, folder.name))
        .filter(file => file.endsWith('.json'))
        .map(file => `motion/${folder.name}/${file}`)
    )
}

/** The stored motion a clip names, as a project path, or null. */
function sourceOf(project, clip) {
  try {
    return JSON.parse(fs.readFileSync(path.join(project, 'assets', clip), 'utf8')).source?.from ?? null
  } catch {
    return null
  }
}

/**
 * Delete the take `clip` (as kimodo.takes names it) from the project at
 * `project`. Answers `{ deleted }`, the project paths removed.
 */
export function deleteTake(project, clip) {
  if (!CLIP_FILE.test(clip ?? '')) throw new Error(`"${clip}" is not a take: name it as kimodo.takes does, motion/<model>/<take>.json`)
  const file = path.join(project, 'assets', clip)
  if (!fs.existsSync(file)) throw new Error(`no take ${clip}`)
  const source = sourceOf(project, clip)
  fs.rmSync(file)
  const deleted = [`assets/${clip}`]
  const isShared = clipsIn(project).some(other => sourceOf(project, other) === source)
  if (source && !isShared && fs.existsSync(path.join(project, source))) {
    fs.rmSync(path.join(project, source), { recursive: true })
    deleted.push(source)
  }
  return { deleted }
}
