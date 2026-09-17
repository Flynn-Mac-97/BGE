/**
 * Measure retargeted clips against the capture they came from, with no picture.
 *
 * Each finding names a likely cause, so an agent knows what to change:
 * - height: the model's size, which says whether the import scale is right.
 * - floor: how far the lowest foot is from the rest floor, per clip.
 * - joints: the largest gap between a joint's place on the model and on the capture, as a share of height.
 * - turned: bones the map lines up with a capture joint pointing the other way (wrong joint, swapped sides).
 * - still: deforming bones that never move while the body does.
 * - loop: how far the last frame is from the first.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { SKELETONS } from './motion-clip.mjs'
import { readModelSkeleton, planRetarget, neutralFor } from './retarget.mjs'
import { readSource, modelFile } from './retarget-clips.mjs'
import { modelPose, capturePose, captureHeading } from './rig-compare.mjs'

const CHECKOUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

/** Limits past which a finding is raised. */
const LIMITS = { floatMetres: 0.08, sinkMetres: 0.05, jointShare: 0.25, alignDegrees: 100, loopDegrees: 15, stillMetres: 0.002 }

const subtract = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const length = vector => Math.hypot(...vector)
const degreesBetween = (a, b) => Math.acos(Math.max(-1, Math.min(1, (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (length(a) * length(b) || 1)))) * 180 / Math.PI
const round = (value, places = 3) => Number(value.toFixed(places))

/** Every clip for this model: the names given, or every file in `assets/motion/<model name>/`. */
function clipFiles(project, modelName, clips) {
  if (clips?.length) return clips.map(name => `motion/${modelName}/${name}.json`)
  const directory = path.join(project, 'assets', 'motion', modelName)
  if (!fs.existsSync(directory)) return []
  return fs.readdirSync(directory).filter(name => name.endsWith('.json')).map(name => `motion/${modelName}/${name}`)
}

function readMap(project, reference) {
  if (!reference || reference === 'given') return null
  const file = reference.startsWith('tools/') ? path.join(CHECKOUT, reference) : path.join(project, reference)
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null
}

function checkClip({ project, model, nodes, reference }) {
  const clip = JSON.parse(fs.readFileSync(path.join(project, 'assets', reference), 'utf8'))
  const report = { clip: reference, frames: clip.rotations.length, findings: [] }
  const frames = clip.rotations.map((_, frame) => modelPose(nodes, clip, frame))

  const feet = nodes.filter(node => /foot|toe|ankle|ball/i.test(node.name) && clip.nodes.includes(node.name)).map(node => node.name)
  if (feet.length) {
    const restFloor = Math.min(...feet.map(name => nodes.find(node => node.name === name).worldPosition[1]))
    const lowest = frames.map(pose => Math.min(...feet.map(name => pose[name].position[1])) - restFloor)
    report.floor = { lowest: round(Math.min(...lowest)), highest: round(Math.max(...lowest)) }
    if (Math.min(...lowest) > LIMITS.floatMetres) report.findings.push(`feet never reach the floor: lowest ${round(Math.min(...lowest))} m above rest. The hips are too high — check the root joint's map entry`)
    if (Math.min(...lowest) < -LIMITS.sinkMetres) report.findings.push(`feet go ${round(-Math.min(...lowest))} m below the floor`)
  }

  const map = readMap(project, clip.source?.map)
  if (map && clip.source?.from) {
    const skeleton = SKELETONS[clip.source.skeleton]
    const plan = planRetarget({ map, skeleton, model: nodes, neutral: neutralFor(clip.source.skeleton) })
    const source = readSource(path.join(project, clip.source.from))
    const heading = captureHeading(source)
    const first = clip.source.kept?.[0] ?? 0
    // Each joint's place from the hips, as a share of height, on both bodies. A
    // wrong bone or swapped sides puts a joint far from where the capture has it.
    const root = plan.find(entry => entry.isRoot)
    const restHeight = body => Math.max(...body) - Math.min(...body)
    const modelHeight = restHeight(nodes.map(node => node.worldPosition[1]))
    let worst = { share: 0 }
    const facing = clip.source.facing || 0
    const across = [Math.cos(facing), 0, -Math.sin(facing)]
    const sideways = vector => vector[0] * across[0] + vector[2] * across[2]
    const swapped = new Set()
    frames.forEach((pose, frame) => {
      const capture = capturePose(source, skeleton, heading, clip.source.facing || 0, first + frame).positions
      const captureHeight = restHeight(capture.map(position => position[1]))
      for (const entry of plan) {
        const built = subtract(pose[entry.node].position, pose[root.node].position).map(value => value / modelHeight)
        const captured = subtract(capture[entry.joint], capture[root.joint]).map(value => value / captureHeight)
        const share = length(subtract(built, captured))
        // A left joint on the model's right: the map has the sides the wrong way round.
        if (Math.abs(sideways(captured)) > 0.05 && sideways(built) * sideways(captured) < 0) swapped.add(entry.node)
        if (share > worst.share) worst = { share, bone: entry.node, joint: skeleton.names[entry.joint], frame }
      }
    })
    const turned = plan.filter(entry => 2 * Math.acos(Math.min(1, Math.abs(entry.alignment[3]))) * 180 / Math.PI > LIMITS.alignDegrees)
    if (turned.length) report.findings.push(`${turned.map(entry => entry.node).slice(0, 6).join(', ')} must turn over ${LIMITS.alignDegrees}° to line up with the capture: the map points them at the wrong joint or the wrong side`)
    if (swapped.size) report.findings.push(`on the wrong side of the body: ${[...swapped].slice(0, 6).join(', ')}. The map has left and right swapped for these`)
    report.joints = { worstShareOfHeight: round(worst.share, 2), bone: worst.bone, joint: worst.joint, frame: worst.frame }
    if (worst.share > LIMITS.jointShare) report.findings.push(`${worst.bone} is ${round(worst.share * 100)}% of body height from where the capture puts ${worst.joint} (frame ${worst.frame}). Check that map entry — wrong bone or swapped sides`)
  }

  const deforming = nodes.some(node => /^def[-_]/i.test(node.name)) ? nodes.filter(node => /^def[-_]/i.test(node.name)) : nodes.filter(node => node.joint)
  const bodyMoves = frames.some(pose => length(subtract(pose[clip.nodes[0]].position, frames[0][clip.nodes[0]].position)) > LIMITS.stillMetres)
    || clip.rotations.some(row => row.some((value, index) => Math.abs(value - clip.rotations[0][index]) > 0.01))
  const still = deforming.filter(node => frames.every(pose =>
    length(subtract(pose[node.name].position, frames[0][node.name].position)) < LIMITS.stillMetres
    && pose[node.name].rotation.every((value, index) => Math.abs(value - frames[0][node.name].rotation[index]) < 1e-3)))
  if (bodyMoves && still.length) {
    report.still = still.map(node => node.name)
    report.findings.push(`${still.length} deforming bones never move: ${report.still.slice(0, 6).join(', ')}. Map them, or they are left behind`)
  }

  if (clip.loop) {
    const last = clip.rotations.length - 1
    const worstTurn = Math.max(...clip.rotations[0].map((_, index) => index % 4 === 0
      ? 2 * Math.acos(Math.min(1, Math.abs(clip.rotations[0].slice(index, index + 4).reduce((sum, value, axis) => sum + value * clip.rotations[last][index + axis], 0)))) * 180 / Math.PI
      : 0))
    report.loop = { seamDegrees: round(worstTurn, 1) }
    if (worstTurn > LIMITS.loopDegrees) report.findings.push(`the loop jumps ${round(worstTurn, 1)}° from its last frame to its first. Generate a longer clip`)
  }
  return report
}

/** Check every clip of one model. */
export function checkClips({ project, model, clips = null }) {
  const file = modelFile(project, model)
  const modelName = path.basename(file, path.extname(file))
  const nodes = readModelSkeleton(file)
  const heights = nodes.map(node => node.worldPosition[1])
  const height = round(Math.max(...heights) - Math.min(...heights), 2)
  const references = clipFiles(project, modelName, clips)
  if (!references.length) throw new Error(`no clips in assets/motion/${modelName} — run rig.retarget first`)
  const reports = references.map(reference => checkClip({ project, model, nodes, reference }))
  const findings = reports.flatMap(report => report.findings.map(finding => `${path.basename(report.clip, '.json')}: ${finding}`))
  if (height < 0.3 || height > 4) findings.unshift(`the skeleton is ${height} m tall. Set the import scale so a person is about 1.75 m (blender.inspect gives scaleForPerson)`)
  return { model: path.relative(path.join(project, 'assets'), file).split(path.sep).join('/'), height, ok: findings.length === 0, findings, clips: reports }
}
