/**
 * Kimodo poser: how close a generated take came to the key poses its design
 * asked for, as numbers. For each keyed hand or foot, the centimetres between
 * where it was asked to be and where the take put it at that frame; the take's
 * pose in words at each key (rig-animation/pose-facts.js); and its faults
 * (rig-animation/motion-faults.js). An agent reads this instead of a picture.
 */
import { readClip, restOf } from '../rig-animation/clip-reading.js'
import { floorOf, poseFacts } from '../rig-animation/pose-facts.js'
import { motionFaults } from '../rig-animation/motion-faults.js'

/** The role a designer handle is, in a read clip's frame. */
const ROLE_OF = {
  RightHand: ['right', 'hand'],
  LeftHand: ['left', 'hand'],
  RightFoot: ['right', 'foot'],
  LeftFoot: ['left', 'foot']
}

/**
 * The comparison for a design and its take: `{ keys: [{ at, words, misses: {
 * handle: cm } }], worstMiss, faults }`. Key points are in model space with
 * no travel, as Kimodo reads them, so the take's root travel is taken off.
 */
export function compareTake(design, clip, skeleton) {
  const read = readClip(skeleton, clip)
  const rest = restOf(skeleton)
  const floor = floorOf(read.frames, rest)
  const times = [...new Set(Object.values(design.keys).flatMap(keys => keys.map(key => key.at)))].sort(
    (first, second) => first - second
  )
  const keys = times.map(at => {
    const frame = Math.min(read.frames.length - 1, Math.round(at * read.framesPerSecond))
    const travel = clip.root ? [clip.root[frame][0], 0, clip.root[frame][2]] : [0, 0, 0]
    const misses = {}
    for (const [handle, handleKeys] of Object.entries(design.keys)) {
      const key = handleKeys.find(candidate => candidate.at === at)
      if (!key) continue
      const [side, role] = ROLE_OF[handle]
      const got = read.frames[frame][side][role].map((value, axis) => value - travel[axis])
      misses[handle] = Math.round(Math.hypot(...got.map((value, axis) => value - key.value[axis])) * 100)
    }
    return { at, words: poseFacts(read.frames[frame], rest, floor).words, misses }
  })
  const worstMiss = Math.max(0, ...keys.flatMap(key => Object.values(key.misses)))
  return { keys, worstMiss, faults: motionFaults(read, rest) }
}
