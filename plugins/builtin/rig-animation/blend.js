/**
 * Rig Animation: a second looping clip blended over the base one by weight,
 * in step with it, as a light run and a heavy run are.
 *
 *   entity.rigBlend = { clip: 'run-heavy', weight: 0.6 }
 *
 * Both clips play at the same point of their cycle: the blend clip starts at
 * the frame whose pose is nearest the base clip's first frame, so a foot down
 * in one is down in the other. The shared cycle runs at a pace between the
 * two clips' own, by weight (`cycleRate`). Both must loop.
 */
import { framesAt, mixInto } from './sample.js'

/** base clip -> blend clip -> the blend clip's frame that matches the base's frame 0. */
const startFrames = new WeakMap()

const cycleSeconds = clip => clip.count / clip.framesPerSecond

/**
 * How much faster the base clip's time runs so both clips keep one cycle: 1
 * with no blend, the base cycle over the blend cycle at full weight.
 */
export function cycleRate(entity, baseClip, blendClip) {
  const weight = entity.rigBlend?.weight ?? 0
  if (!blendClip?.loop || !baseClip.loop || weight <= 0) return 1
  return 1 + (cycleSeconds(baseClip) / cycleSeconds(blendClip) - 1) * weight
}

/** Mix the blend clip over the pose the base clip wrote, at the base clip's point in its cycle. */
export function applyBlend(entity, baseClip, blendClip) {
  const weight = Math.min(1, entity.rigBlend?.weight ?? 0)
  if (!blendClip?.loop || !baseClip.loop || weight <= 0 || !entity.pose) return
  const cycle = (entity._rigTime / cycleSeconds(baseClip)) % 1
  const time = (startFrameOf(baseClip, blendClip) / blendClip.framesPerSecond) + cycle * cycleSeconds(blendClip)
  const { first, second, blend } = framesAt(blendClip, time)
  const sampled = [0, 0, 0, 1]
  blendClip.nodes.forEach((node, index) => {
    const into = entity.pose[node]
    if (!into) return
    mixInto(sampled, blendClip.rotations[first], blendClip.rotations[second], index * 4, blend)
    mixInto(into, into, sampled, 0, weight)
  })
  for (const node in blendClip.positions) {
    const into = entity.pose[node]
    if (!into) continue
    const from = blendClip.positions[node][first]
    const to = blendClip.positions[node][second]
    for (let axis = 0; axis < 3; axis++) into[4 + axis] += (from[axis] + (to[axis] - from[axis]) * blend - into[4 + axis]) * weight
  }
}

/** The blend clip's frame nearest the base clip's first frame, over the nodes both pose. */
function startFrameOf(baseClip, blendClip) {
  if (!startFrames.has(baseClip)) startFrames.set(baseClip, new WeakMap())
  const known = startFrames.get(baseClip)
  if (!known.has(blendClip)) known.set(blendClip, nearestFrame(baseClip, blendClip))
  return known.get(blendClip)
}

function nearestFrame(baseClip, blendClip) {
  const shared = baseClip.nodes.map((node, index) => [index, blendClip.nodes.indexOf(node)]).filter(([, other]) => other >= 0)
  const start = baseClip.rotations[0]
  let nearest = 0
  let smallest = Infinity
  blendClip.rotations.forEach((frame, index) => {
    // 1 - |dot| per node: 0 for the same turn, whichever sign stores it.
    const distance = shared.reduce((sum, [base, other]) => {
      let dot = 0
      for (let part = 0; part < 4; part++) dot += start[base * 4 + part] * frame[other * 4 + part]
      return sum + 1 - Math.abs(dot)
    }, 0)
    if (distance < smallest) [nearest, smallest] = [index, distance]
  })
  return nearest
}
