/**
 * Check a retargeted clip in Blender: the model posed by the clip beside the
 * capture it came from, front and side, a few frames, on one sheet.
 *
 * The model is posed from the same numbers the engine plays, with constraints
 * muted and B-bone segments at 1 — what the engine can draw. A pose that is
 * wrong on the sheet is wrong in the retarget; a pose that is right on the
 * sheet and wrong in the game is wrong in the engine.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { SKELETONS } from './motion-clip.mjs'
import { readModelSkeleton, captureWorldTurns, multiply, meanHeading, parentsFirst } from './retarget.mjs'
import { readSource, modelFile } from './retarget-clips.mjs'

export const COMPARE_SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'rig-compare.py')

const rotate = (turn, vector) => {
  const moved = multiply(multiply(turn, [...vector, 0]), [-turn[0], -turn[1], -turn[2], turn[3]])
  return [moved[0], moved[1], moved[2]]
}

/** Every model node's world rotation and position at one clip frame, in glTF metres, by node name. */
export function modelPose(model, clip, frame) {
  const turns = new Map(clip.nodes.map((name, index) => [name, clip.rotations[frame].slice(index * 4, index * 4 + 4)]))
  const world = []
  const place = []
  const scale = []
  for (const index of parentsFirst(model)) {
    const node = model[index]
    const parent = node.parent
    const turn = turns.get(node.name) || node.rotation
    const translation = clip.positions?.[node.name]?.[frame] || node.translation
    world[index] = parent >= 0 ? multiply(world[parent], turn) : turn
    scale[index] = (parent >= 0 ? scale[parent] : 1) * node.scale
    place[index] = parent >= 0
      ? place[parent].map((value, axis) => value + rotate(world[parent], translation.map(part => part * scale[parent]))[axis])
      : translation
  }
  return Object.fromEntries(model.map((node, index) => [node.name, { rotation: world[index], position: place[index] }]))
}

/** Capture joint positions at one source frame, turned to the model's facing, hips over the origin. */
export function capturePose(source, skeleton, heading, facing, frame) {
  const locals = skeleton.names.map((_, joint) => Array.from(source.rotations.slice((frame * source.joints + joint) * 4, (frame * source.joints + joint + 1) * 4)))
  const turns = captureWorldTurns(locals, skeleton, heading)
  const facingTurn = [0, Math.sin(facing / 2), 0, Math.cos(facing / 2)]
  const positions = []
  skeleton.names.forEach((_, joint) => {
    const parent = skeleton.parents[joint]
    positions[joint] = parent < 0
      ? [0, source.root[frame * 3 + 1], 0]
      : positions[parent].map((value, axis) => value + rotate(turns[parent], skeleton.offsets[joint])[axis])
  })
  return { parents: skeleton.parents, positions: positions.map(position => rotate(facingTurn, position)) }
}

const pick = (pose, names) => Object.fromEntries(names.map(name => [name, pose[name]]))

/** The capture's mean root facing, which the retarget removed. */
export function captureHeading(source) {
  return meanHeading(Array.from({ length: source.frames }, (_, frame) =>
    Array.from(source.rotations.slice(frame * source.joints * 4, frame * source.joints * 4 + 4))))
}

/** The clip frames to show: `frames` as given, or four spread evenly. */
const chooseFrames = (frames, count) => (frames?.length ? frames : [0, 1, 2, 3].map(step => Math.floor(step * count / 4)))

/**
 * Write the poses file the Blender script reads. Returns what it needs to run.
 * `clip` is a clip name under `assets/motion/<model name>/`, or a path under `assets`.
 */
export function writeComparePoses({ project, model, clip, frames = null, out }) {
  const file = modelFile(project, model)
  const modelName = path.basename(file, path.extname(file))
  const clipReference = clip.endsWith('.json') ? clip : `motion/${modelName}/${clip}.json`
  const clipData = JSON.parse(fs.readFileSync(path.join(project, 'assets', clipReference), 'utf8'))
  if (!clipData.source?.from) throw new Error(`${clipReference} records no source motion, so there is no capture to compare against`)
  const source = readSource(path.join(project, clipData.source.from))
  const skeleton = SKELETONS[clipData.source.skeleton]
  const nodes = readModelSkeleton(file)
  const heading = captureHeading(source)
  const first = clipData.source.kept?.[0] ?? 0
  const facing = clipData.source.facing || 0
  const chosen = chooseFrames(frames, clipData.rotations.length).filter(frame => frame < clipData.rotations.length)

  const blend = file.replace(/\.glb$/i, '.blend')
  if (!fs.existsSync(blend)) throw new Error(`no ${path.basename(blend)} beside the model — the comparison poses the .blend the model was built from`)
  const settingsFile = file.replace(/\.glb$/i, '.import.json')
  const settings = fs.existsSync(settingsFile) ? JSON.parse(fs.readFileSync(settingsFile, 'utf8')) : {}

  fs.mkdirSync(out, { recursive: true })
  const poses = path.join(out, 'poses.json')
  fs.writeFileSync(poses, JSON.stringify({
    clip: clipReference,
    nodes: clipData.nodes,
    scale: settings.scale ?? 1,
    collection: settings.collection ?? null,
    facing,
    frames: chosen.map(frame => ({
      clipFrame: frame,
      sourceFrame: first + frame,
      model: pick(modelPose(nodes, clipData, frame), clipData.nodes),
      capture: capturePose(source, skeleton, heading, facing, first + frame)
    }))
  }))
  return { blend, poses, out, frames: chosen, clip: clipReference }
}
