/**
 * Kimodo's node half for a take's files: delete a take from a project, and
 * cut one again from its stored motion. Node only: the page writes files but
 * removes none, and cutting retargets.
 *
 * A take is its clip, `assets/motion/<model>/<take>.json`, and the stored
 * motion it was made from, `assets/motion/source/<take>/`. The motion goes
 * too unless another clip in the project names it, such as the same take
 * retargeted onto a second model.
 */
import fs from 'node:fs'
import path from 'node:path'
import { readSource, sourceClip } from '../../../tools/lib/retarget-clips.mjs'
import { writeClip } from '../../../tools/lib/motion-clip.mjs'

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

/** A take's clip file read, with what cutting it needs: its model, stored motion name and frame count. */
function takeToCut(project, clip) {
  if (!CLIP_FILE.test(clip ?? '')) throw new Error(`"${clip}" is not a take: name it as kimodo.takes does, motion/<model>/<take>.json`)
  const file = path.join(project, 'assets', clip)
  if (!fs.existsSync(file)) throw new Error(`no take ${clip}`)
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (!raw.source?.from) throw new Error(`${clip} names no stored motion, so it cannot be cut again`)
  const source = path.basename(raw.source.from)
  const frames = readSource(path.join(project, raw.source.from)).frames
  return { file, raw, source, frames, model: `models/${clip.split('/')[1]}.glb` }
}

/**
 * The whole take, every frame Kimodo made, for a person to choose a cut:
 * `{ clip, frames, kept }`. `kept` is the cut the take has now, `[first, last]`
 * with `last` not kept, or the whole take when it was never cut.
 */
export function fullTake(project, clip) {
  const take = takeToCut(project, clip)
  const { clip: whole } = sourceClip({ project, model: take.model, name: take.source, loop: take.raw.loop, cycle: false })
  return { clip: { ...whole, name: take.raw.name }, frames: take.frames, kept: take.raw.source.kept ?? [0, take.frames] }
}

/**
 * Cut the take again from its stored motion, keeping capture frames `first` up
 * to `last`, `last` not kept. A loop is closed onto frame `last`, so `last` is
 * the pose it goes back to. Answers `{ clip, frames }`, the frames now in it.
 */
export function cutTake(project, clip, first, last) {
  const take = takeToCut(project, clip)
  const isLoop = take.raw.loop !== false
  // A loop reads frame `last` to close onto; a take that plays once does not.
  const end = isLoop ? take.frames - 1 : take.frames
  if (!(Number.isInteger(first) && Number.isInteger(last) && first >= 0 && last <= end && last - first >= 2))
    throw new Error(`a cut is two whole frames at least 2 apart, within 0..${end}; got ${first}..${last}`)
  const { clip: cut } = sourceClip({ project, model: take.model, name: take.source, loop: isLoop, window: { first, last } })
  writeClip(take.file, { ...cut, name: take.raw.name })
  return { clip, frames: cut.rotations.length }
}
