/**
 * Rig Animation: what is wrong with a clip, measured, so an agent can judge a
 * motion without a picture and see a fix land.
 *
 * Each fault is `{ kind, part, from, to, measured, limit, advice }`: seconds
 * where it happens, the number that broke the limit and the limit, and what
 * usually fixes it. Limits are fixed numbers for a body about 1.7 m tall,
 * scaled by the rest pose's height (clip-reading.js), so a small body is held
 * to small numbers.
 *
 *   hover    the whole take stands above its floor: its lowest foot never comes down
 *   slide    a planted foot moves over the floor
 *   float    both feet are off the floor while the body is not moving
 *   through  a hand or elbow is inside the torso
 *   jitter   a joint jerks from one frame to the next
 *   balance  the hips are outside the planted feet while the body stands
 *   pop      a looping clip's last frame does not meet its first
 */
import { PLANTED, distanceBetween, floorOf, liftOf } from './pose-facts.js'
import { subtract } from '../game-maths/space.js'

/** The body height these limits are written for. */
const REFERENCE_HEIGHT = 1.7

/** Limits in metres (and seconds) for the reference body. */
const LIMITS = {
  slideSpeed: 0.15,
  slideDistance: 0.03,
  floatSeconds: 0.2,
  torsoRadius: 0.09,
  jitter: 0.015,
  hover: 0.02,
  balanceMargin: 0.1,
  balanceSeconds: 0.25,
  standingSpeed: 0.5,
  pop: 0.05
}

const ADVICE = {
  slide:
    'hold the foot with a joint constraint over those seconds, or pick a take whose clip plants it (Rig Animation plants only a foot the clip holds still)',
  hover: 'the take stands its feet above the floor all through: lower the clip by the hover, or pick another take',
  float: 'the take floats the body: keep ground paths at 4 m/s or less, or pick another take',
  through:
    'hold the hand clear of the body with a joint constraint, or reword the prompt so the arm does not cross the body',
  jitter: 'the take shakes there: generate it again with more diffusion steps or another seed',
  balance: 'the weight is outside the feet: widen the stance with a foot constraint, or pick another take',
  pop: 'the loop does not meet itself: generate it with --loop, or cut the clip where two frames match'
}

/** A fault record, the one shape every check answers. */
const faultOf = (kind, part, frames, fps, measured, limit) => ({
  kind,
  part,
  from: round(frames[0] / fps),
  to: round(frames[frames.length - 1] / fps),
  measured: round(measured),
  limit: round(limit),
  advice: ADVICE[kind]
})

const round = value => Math.round(value * 1000) / 1000
const level = vector => [vector[0], 0, vector[2]]

/** Runs of consecutive frame numbers where `isIn(frame)` holds. */
function runsOf(count, isIn) {
  const runs = []
  let run = []
  for (let frame = 0; frame < count; frame++) {
    if (isIn(frame)) run.push(frame)
    else if (run.length) {
      runs.push(run)
      run = []
    }
  }
  if (run.length) runs.push(run)
  return runs
}

/** Whether a foot is on the clip's own floor at a frame (`read.floor`, pose-facts.js). */
const isPlanted = (read, rest, frame, side) => liftOf(read.frames[frame], rest, side) - read.floor < PLANTED

/** How fast the hips cross the floor at a frame, metres a second. */
const hipsSpeed = (frames, frame, fps) =>
  frame === 0 ? 0 : distanceBetween(level(frames[frame].hips), level(frames[frame - 1].hips)) * fps

/** A planted foot that moves over the floor. */
function slides(read, rest, limits) {
  const { frames, framesPerSecond: fps } = read
  return ['left', 'right'].flatMap(side =>
    runsOf(frames.length, frame => isPlanted(read, rest, frame, side))
      .filter(run => run.length >= 3)
      .flatMap(run => {
        const steps = run
          .slice(1)
          .map(frame => distanceBetween(level(frames[frame][side].foot), level(frames[frame - 1][side].foot)))
        const distance = steps.reduce((total, step) => total + step, 0)
        const speed = Math.max(...steps) * fps
        return distance > limits.slideDistance && speed > limits.slideSpeed
          ? [faultOf('slide', `${side} foot`, run, fps, distance, limits.slideDistance)]
          : []
      })
  )
}

/** Both feet off the floor while the body stands. */
function floats(read, rest, limits) {
  const { frames, framesPerSecond: fps } = read
  const isFloating = frame =>
    !isPlanted(read, rest, frame, 'left') &&
    !isPlanted(read, rest, frame, 'right') &&
    hipsSpeed(frames, frame, fps) < limits.standingSpeed
  return runsOf(frames.length, isFloating)
    .filter(run => run.length / fps >= limits.floatSeconds)
    .map(run => {
      const lowest = Math.min(
        ...run.map(frame => Math.min(...['left', 'right'].map(side => liftOf(frames[frame], rest, side) - read.floor)))
      )
      return faultOf('float', 'feet', run, fps, lowest, PLANTED)
    })
}

/** Distance from a point to the segment between two others. */
function toSegment(point, from, to) {
  const along = subtract(to, from)
  const share = Math.max(0, Math.min(1, dotOf(subtract(point, from), along) / (dotOf(along, along) || 1)))
  return distanceBetween(
    point,
    from.map((value, axis) => value + along[axis] * share)
  )
}
const dotOf = (first, second) => first[0] * second[0] + first[1] * second[1] + first[2] * second[2]

/** A hand or elbow inside the torso, hips to neck. */
function throughs(read, rest, limits) {
  const { frames, framesPerSecond: fps } = read
  return ['left', 'right'].flatMap(side =>
    ['hand', 'elbow'].flatMap(part => {
      const depth = frame => toSegment(frames[frame][side][part], frames[frame].hips, frames[frame].neck)
      return runsOf(frames.length, frame => depth(frame) < limits.torsoRadius).map(run =>
        faultOf('through', `${side} ${part}`, run, fps, Math.min(...run.map(depth)), limits.torsoRadius)
      )
    })
  )
}

/**
 * A joint that zigzags: its path bends one way and then straight back the
 * other on the next frame, both bends past the limit. A fast smooth swing
 * bends a lot but keeps bending the same way, so it is not a shake.
 */
function jitters(read, rest, limits) {
  const { frames, framesPerSecond: fps } = read
  const joints = [
    ['head', frame => frames[frame].head],
    // Not feet or knees: a foot landing stops dead, which is a zigzag and is right.
    ...['left', 'right'].flatMap(side =>
      ['hand', 'elbow'].map(part => [`${side} ${part}`, frame => frames[frame][side][part]])
    )
  ]
  return joints.flatMap(([part, at]) => {
    const bend = frame => subtract(subtract(at(frame + 1), at(frame)), subtract(at(frame), at(frame - 1)))
    const size = frame => Math.hypot(...bend(frame))
    const isZigzag = frame =>
      frame > 0 &&
      frame < frames.length - 2 &&
      size(frame) > limits.jitter &&
      size(frame + 1) > limits.jitter &&
      dotOf(bend(frame), bend(frame + 1)) < 0
    return runsOf(frames.length, isZigzag).map(run =>
      faultOf('jitter', part, run, fps, Math.max(...run.map(size)), limits.jitter)
    )
  })
}

/** How far the hips are, over the floor, outside what the planted feet cover. */
function outsideFeet(frame, planted) {
  const hips = level(frame.hips)
  const points = planted.flatMap(side => [frame[side].foot, frame[side].toe].filter(Boolean).map(level))
  if (points.length === 1) return distanceBetween(hips, points[0])
  // Near enough for a stance: the nearest segment between any two foot points.
  let nearest = Infinity
  for (let first = 0; first < points.length; first++) {
    for (let second = first + 1; second < points.length; second++)
      nearest = Math.min(nearest, toSegment(hips, points[first], points[second]))
  }
  return nearest
}

/** The hips outside the planted feet while the body stands. */
function balances(read, rest, limits) {
  const { frames, framesPerSecond: fps } = read
  const plantedAt = frame => ['left', 'right'].filter(side => isPlanted(read, rest, frame, side))
  const offBy = frame => outsideFeet(frames[frame], plantedAt(frame))
  const isOff = frame =>
    plantedAt(frame).length > 0 &&
    hipsSpeed(frames, frame, fps) < limits.standingSpeed &&
    offBy(frame) > limits.balanceMargin
  return runsOf(frames.length, isOff)
    .filter(run => run.length / fps >= limits.balanceSeconds)
    .map(run => faultOf('balance', 'hips', run, fps, Math.max(...run.map(offBy)), limits.balanceMargin))
}

/** A looping clip's last frame against its first, each joint measured from the hips. */
function pops(read, rest, limits) {
  const { frames, framesPerSecond: fps, loop } = read
  if (!loop || frames.length < 2) return []
  const last = frames.length - 1
  const fromHips = (frame, point) => subtract(point, level(frames[frame].hips))
  const parts = ['left', 'right'].flatMap(side =>
    ['hand', 'foot'].map(part => [`${side} ${part}`, frame => frames[frame][side][part]])
  )
  const gaps = parts.map(([part, at]) => [part, distanceBetween(fromHips(0, at(0)), fromHips(last, at(last)))])
  const [part, worst] = gaps.reduce((best, gap) => (gap[1] > best[1] ? gap : best))
  return worst > limits.pop ? [faultOf('pop', part, [last, last], fps, worst, limits.pop)] : []
}

/** The whole take standing above its floor. */
function hovers(read, rest, limits) {
  return read.floor > limits.hover
    ? [faultOf('hover', 'feet', [0, read.frames.length - 1], read.framesPerSecond, read.floor, limits.hover)]
    : []
}

const CHECKS = [hovers, slides, floats, throughs, jitters, balances, pops]

/**
 * Every fault in a read clip (clip-reading.js), worst kinds first as CHECKS
 * lists them. Limits scale with the rest pose's standing height.
 */
export function motionFaults(read, rest) {
  const scale = rest.head[1] / REFERENCE_HEIGHT
  const limits = Object.fromEntries(
    Object.entries(LIMITS).map(([name, value]) => [name, name.endsWith('Seconds') ? value : value * scale])
  )
  const withFloor = { ...read, floor: floorOf(read.frames, rest) }
  return CHECKS.flatMap(check => check(withFloor, rest, limits))
}
