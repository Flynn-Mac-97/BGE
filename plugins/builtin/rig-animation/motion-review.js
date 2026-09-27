/**
 * Rig Animation: `rig.pose` and `rig.faults`, a clip judged as numbers and
 * words rather than as a picture. Both run headless: they read the clip and
 * the skeleton files, not the live page.
 *
 * A clip is named as the type declares it, `{ "type": "player", "clip":
 * "slash" }`, or by file with the skeleton, `{ "file": "motion/fighter/
 * take-slash-a.json", "skeleton": "motion/fighter.skeleton.json" }`, so a
 * take can be judged before it is used.
 */
import { readClip, restOf } from './clip-reading.js'
import { floorOf, poseFacts } from './pose-facts.js'
import { motionFaults } from './motion-faults.js'
import { widenSkeleton } from './skeleton.js'

/** The clip and skeleton files a request names, or an error. */
function filesOf(context, options) {
  if (options.file) {
    return options.skeleton
      ? { clip: options.file, skeleton: options.skeleton }
      : { error: 'a clip file needs its skeleton: {"file":"...","skeleton":"motion/<model>.skeleton.json"}' }
  }
  const entity = context.world.entities.find(
    candidate => candidate.type === options.type || candidate.id === options.type
  )
  const rig = entity?._definition?.rig
  if (!rig)
    return {
      error: `no rigged entity of type "${options.type}" in the level: name {"type":..., "clip":...} or {"file":..., "skeleton":...}`
    }
  const clip = rig.clips?.[options.clip]
  if (!clip)
    return {
      error: `the ${options.type} type has no clip "${options.clip}" — try ${Object.keys(rig.clips ?? {}).join(', ')}`
    }
  return { clip, skeleton: rig.skeleton }
}

/**
 * The named clip read as joint positions, with its rest pose: `{ read, rest,
 * clip }`, or `{ error }`. `load(file, widen?)` is Rig Animation's own cached
 * file read.
 */
async function motionOf(context, options, load) {
  const files = filesOf(context, options)
  if (files.error) return files
  const [clipEntry, skeletonEntry] = [load(files.clip), load(files.skeleton, widenSkeleton)]
  await Promise.all([clipEntry.waiting, skeletonEntry.waiting])
  const failed = [clipEntry, skeletonEntry].find(entry => entry.status !== 'ready')
  if (failed) return { error: failed.error ?? 'the clip or skeleton did not load' }
  return { read: readClip(skeletonEntry.value, clipEntry.value), rest: restOf(skeletonEntry.value), clip: files.clip }
}

/** rig.pose: the facts of one moment, `at` seconds in (0 when left out). */
export async function poseOfClip(context, options, load) {
  const motion = await motionOf(context, options, load)
  if (motion.error) return motion
  const { read, rest } = motion
  const frame = Math.max(0, Math.min(read.frames.length - 1, Math.round((options.at ?? 0) * read.framesPerSecond)))
  return {
    clip: motion.clip,
    at: frame / read.framesPerSecond,
    frame,
    ...poseFacts(read.frames[frame], rest, floorOf(read.frames, rest))
  }
}

/** rig.faults: every fault in the clip, and the words of its first, middle and last frames. */
export async function faultsOfClip(context, options, load) {
  const motion = await motionOf(context, options, load)
  if (motion.error) return motion
  const { read, rest } = motion
  const faults = motionFaults(read, rest)
  const floor = floorOf(read.frames, rest)
  const wordsAt = frame => poseFacts(read.frames[frame], rest, floor).words
  const last = read.frames.length - 1
  return {
    clip: motion.clip,
    seconds: Math.round((last / read.framesPerSecond) * 1000) / 1000,
    isClean: faults.length === 0,
    faults,
    moments: { start: wordsAt(0), middle: wordsAt(Math.round(last / 2)), end: wordsAt(last) }
  }
}
