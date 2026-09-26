/**
 * Rig Animation: the crossfade when the base clip changes. The clip left
 * behind keeps playing and is mixed over the new one, its weight falling from
 * 1 to 0 over `rig.clipFade` seconds (0.2), so walk to run or run to idle
 * does not snap.
 */
import { framesAt, mixInto } from './sample.js'

/** What `entity._rigFrom` holds when `file` stops being the base clip at clip time `time`. */
export const crossfadeFrom = (file, time) => ({ file, time, weight: 1 })

/**
 * Mix the clip left behind over the pose the new clip wrote, and step its time
 * and weight. `clipOf(file)` is the loaded clip, or null while it loads.
 */
export function applyCrossfade(entity, rig, seconds, clipOf) {
  const from = entity._rigFrom
  if (!from) return
  const fade = rig.clipFade ?? 0.2
  from.weight -= fade > 0 ? seconds / fade : 1
  from.time += seconds * (entity.rigSpeed ?? 1)
  const clip = clipOf(from.file)
  if (from.weight <= 0 || !clip || !entity.pose) {
    entity._rigFrom = null
    return
  }
  const { first, second, blend } = framesAt(clip, from.time)
  const sampled = [0, 0, 0, 1]
  clip.nodes.forEach((node, index) => {
    const into = entity.pose[node]
    if (!into) return
    mixInto(sampled, clip.rotations[first], clip.rotations[second], index * 4, blend)
    mixInto(into, into, sampled, 0, from.weight)
  })
  for (const node in clip.positions) {
    const into = entity.pose[node]
    if (!into) continue
    const place = clip.positions[node][first].map((value, axis) => value + (clip.positions[node][second][axis] - value) * blend)
    for (let axis = 0; axis < 3; axis++) into[4 + axis] += (place[axis] - into[4 + axis]) * from.weight
  }
}
