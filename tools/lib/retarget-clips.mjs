/**
 * Put stored motion onto a model: one clip file per source, in one call.
 *
 * Generated motion is stored raw in `<project>/assets/motion/source/<name>/`, so
 * it can go onto any model later without generating it again. This reads each
 * source, finds the bone map that fits the model, retargets through the model's
 * rest pose, trims a looping clip to its best cycle, and writes
 * `assets/motion/<model name>/<name>.json`, and the model's skeleton as
 * `assets/motion/<model name>.skeleton.json`, which Rig Animation's constraints
 * read. It is outside the clip folder, where every file is a clip.
 *
 * Used by `tools/make-rig-clip.mjs --model` and the `rig.retarget` command.
 */
import fs from 'node:fs'
import path from 'node:path'
import { buildClip, writeClip, readFloats, skeletonFor, SKELETONS } from './motion-clip.mjs'
import { readModelSkeleton, planRetarget, neutralFor } from './retarget.mjs'
import { findMap } from './rig-maps.mjs'

export const SOURCE_DIRECTORY = 'assets/motion/source'

/**
 * Which way the model faces, and the yaw that turns it to face a travel
 * direction. The engine draws yaw 0 facing -Z; the capture faces +Z.
 */
function describeFacing(radians) {
  const degrees = Math.round(radians * 180 / Math.PI)
  const faces = { 0: '+Z', 90: '+X', 180: '-Z', '-180': '-Z', '-90': '-X', 270: '-X' }[degrees] || `${degrees} degrees from +Z`
  return { faces, yaw: `entity.yaw = Math.atan2(directionX, directionZ)${degrees ? ` - ${radians.toFixed(4)}` : ''}` }
}

/** Where the map came from: a project path, a shelf path under the checkout, or 'given'. */
function mapReference(project, chosen) {
  if (!chosen.file) return 'given'
  return chosen.file.startsWith(project)
    ? path.relative(project, chosen.file).split(path.sep).join('/')
    : `tools/lib/rig-maps/${path.basename(chosen.file)}`
}

/** Stored motion names in a project, each with its prompt when one was saved. */
export function listSources(project) {
  const directory = path.join(project, SOURCE_DIRECTORY)
  if (!fs.existsSync(directory)) return []
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && fs.existsSync(path.join(directory, entry.name, 'local_rotations_xyzw.f32')))
    .map(entry => ({ name: entry.name, prompt: readPrompt(path.join(directory, entry.name)) }))
}

export function readPrompt(directory) {
  const file = path.join(directory, 'prompt.txt')
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim() : null
}

/** A model path as a type names it (`models/x.glb`), or an absolute one, to a file on disk. */
export function modelFile(project, model) {
  const candidates = path.isAbsolute(model) ? [model] : [path.join(project, 'assets', model), path.join(project, model), path.resolve(model)]
  const found = candidates.find(candidate => fs.existsSync(candidate))
  if (!found) throw new Error(`no model at ${model} — name it as a type does, like models/hero.glb`)
  return found
}

/**
 * Write a model's skeleton as `assets/motion/<model name>.skeleton.json`: every
 * node's parent and rest place, keyed by name. Answers the file as a type names it.
 */
export function writeSkeleton({ project, model }) {
  const file = modelFile(project, model)
  const nodes = readModelSkeleton(file)
  const record = {
    model: path.relative(path.join(project, 'assets'), file).split(path.sep).join('/'),
    nodes: Object.fromEntries(nodes.map(node => [node.name, {
      parent: node.parent >= 0 ? nodes[node.parent].name : null,
      position: node.translation,
      rotation: node.rotation,
      scale: node.scale
    }]))
  }
  const reference = `motion/${path.basename(file, path.extname(file))}.skeleton.json`
  const out = path.join(project, 'assets', reference)
  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.writeFileSync(out, JSON.stringify(record, null, 2) + '\n')
  return reference
}

/** Raw buffers from a source directory: rotations, root, frame and joint counts. */
export function readSource(directory) {
  const rotationsFile = path.join(directory, 'local_rotations_xyzw.f32')
  if (!fs.existsSync(rotationsFile)) throw new Error(`no stored motion at ${directory}`)
  const rotations = readFloats(rotationsFile)
  const rootFile = path.join(directory, 'root_positions.f32')
  const root = fs.existsSync(rootFile) ? readFloats(rootFile) : null
  if (!root) throw new Error(`${directory} has no root_positions.f32, so its frame count is unknown`)
  const frames = root.length / 3
  return { rotations, root, frames, joints: rotations.length / 4 / frames }
}

/**
 * One stored motion built as a clip on a model, not written: `{ clip, chosen }`,
 * `chosen` the bone map used. A loop is cut where it loops best unless
 * `window` (`{ first, last }`, capture frames, `last` not kept) is given; `cycle`
 * false keeps every frame, which is how a person sees the whole take to cut it.
 */
export function sourceClip({ project, model, name, loop = true, cycle = loop, window = null, map = null, framesPerSecond = 30 }) {
  const file = modelFile(project, model)
  const skeletonNodes = readModelSkeleton(file)
  const directory = path.join(project, SOURCE_DIRECTORY, name)
  const motion = readSource(directory)
  const skeleton = skeletonFor(motion.joints)
  if (!skeleton) throw new Error(`${name}: no known skeleton has ${motion.joints} joints`)
  const modelName = path.basename(file, path.extname(file))
  const chosen = map ? { rig: 'given', map, guessed: false } : findMap(skeleton, skeletonNodes, { project, modelName })
  chosen.facing ??= planRetarget({ map: chosen.map, skeleton: SKELETONS[skeleton], model: skeletonNodes, neutral: neutralFor(skeleton) }).facing
  const clip = buildClip({
    ...motion, skeleton, map: chosen.map, model: skeletonNodes, cycle, loop, window, framesPerSecond, name,
    source: { skeleton, prompt: readPrompt(directory), from: `${SOURCE_DIRECTORY}/${name}`, rig: chosen.rig, map: mapReference(project, chosen), facing: chosen.facing }
  })
  return { clip, chosen }
}

/**
 * Retarget named sources onto one model.
 *
 * `clips` is a list of source names, or all stored sources when left out.
 * `once` names clips that play once, which are not trimmed to a cycle.
 * Returns what was written and the `rig` block a type declares.
 */
export function retargetSources({ project, model, clips = null, once = [], map = null, framesPerSecond = 30 }) {
  const file = modelFile(project, model)
  const names = clips?.length ? clips : listSources(project).map(source => source.name)
  if (!names.length) throw new Error(`no stored motion in ${SOURCE_DIRECTORY} — generate some with tools/make-rig-clip.mjs --prompt`)
  const modelName = path.basename(file, path.extname(file))
  const written = []
  let chosen = null
  for (const name of names) {
    const built = sourceClip({ project, model, name, loop: !once.includes(name), map, framesPerSecond })
    chosen ||= built.chosen
    const reference = `motion/${modelName}/${name}.json`
    writeClip(path.join(project, 'assets', reference), built.clip)
    written.push({ name, file: reference, frames: built.clip.rotations.length, nodes: built.clip.nodes.length })
  }
  const skeleton = writeSkeleton({ project, model })
  return {
    model: path.relative(path.join(project, 'assets'), file).split(path.sep).join('/'),
    rig: chosen.rig,
    map: mapReference(project, chosen),
    ...(chosen.guessed ? { guessed: `the bone map was guessed from node names; check ${mapReference(project, chosen)}`, unmatched: chosen.unmatched } : {}),
    facing: describeFacing(chosen.facing),
    written,
    declare: { rig: { clips: Object.fromEntries(written.map(one => [one.name, one.file])), default: written[0].name, rootMotion: false, skeleton } }
  }
}
