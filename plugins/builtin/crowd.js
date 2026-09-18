/**
 * Crowd — hundreds of entities moving as one mass, and none of them stacking.
 *
 * A horde game, a stampede, a queue of shoppers: the same problem every time.
 * A hundred things seeking one point converge onto one line, and a line of a
 * hundred things looks exactly like one thing. What makes a crowd read as a
 * crowd is that its members refuse to be in the same place.
 *
 * Finding who is near whom is Spatial Hash's job; this is the pass that moves
 * them, built on that group.
 *
 *     const crowd = context.crowd.group('horde', { cellSize: 1.4 })
 *     crowd.add(entity)
 *     crowd.drive(seconds, { towards: player, separation: 1.1 })
 *     crowd.near(x, z, 3)
 *
 * A group is driven by whoever owns it, from that plugin's own fixed system, so
 * "decide, then move" stays where a reader can see it. Numbers come from the
 * caller and from each member's own `speed`, `radius` and `wander`. This file
 * holds none of a game's tuning.
 */
import { groupRegistry } from './spatial-hash/registry.js'

const DEFAULT_SPEED = 1

/** How much of an overlap is pushed out per step. All of it at once makes bodies pop rather than jostle. */
const DEFAULT_RELAX = 0.5

/** Radians a second the wander angle swings through: one slow wobble, not a vibration. */
const WANDER_RATE = 1.7

const TAU = Math.PI * 2

function makeCrowd(name, context, options = {}) {
  // The same group Spatial Hash hands out under this name, not a private one:
  // it is the map that hears `entity:removed` and marks every index stale, and
  // a crowd holding a group nobody had registered would go on answering
  // questions with entities that no longer exist.
  const group = context.spatial.group(name, options)
  const defaultSpeed = options.speed ?? DEFAULT_SPEED
  let lastWork = { pairs: 0, members: 0 }

  /**
   * Move the whole group one step: go at the target, and get out of each
   * other's way while doing it.
   *
   * Separation is blended into the heading and the result renormalised, so a
   * crowded member turns aside rather than slowing down. That is the difference
   * between a mass that spreads around its target and one that piles into a
   * column behind whoever got there first, and it keeps the crowd as fast when
   * it is thick as when it is thin.
   *
   * A second, smaller correction moves bodies apart outright. Steering alone
   * never fully resolves an overlap when everything pushes the same way, and
   * the leftover is exactly the stack this file exists to prevent.
   */
  function drive(seconds, driveOptions = {}) {
    group.index()
    const flat = group.flat
    const count = flat.count
    if (!count) return 0

    const plan = drivePlan(seconds, driveOptions, flat)
    let pairs = 0
    for (let at = 0; at < count; at++) pairs += stepMember(flat, at, plan)

    // Everything moved, so the grid built at the top of this call is stale.
    // Saying so makes the next near() rebuild rather than answer from where
    // everything used to be.
    group.invalidate()
    lastWork = { pairs, members: count }
    return count
  }

  /**
   * The step's own numbers, read from the caller once and then read by every
   * member. Enough cells each way to cover the widest pair there is, whatever
   * the grid was re-cut to.
   */
  function drivePlan(seconds, driveOptions, flat) {
    const towards = driveOptions.towards
    const targetX = towards?.x ?? 0
    const targetZ = towards?.z ?? 0
    return {
      seconds,
      time: context.time,
      defaultSpeed,
      targetX,
      targetZ,
      hasTarget: aimed(towards, targetX, targetZ),
      separation: driveOptions.separation ?? 1,
      relax: driveOptions.relax ?? DEFAULT_RELAX,
      face: driveOptions.face !== false,
      span: Math.max(1, Math.ceil((flat.widest * 2) / flat.cellSize))
    }
  }

  return {
    name,
    group,
    get members() { return group.members },
    get size() { return group.size },
    get flat() { return group.flat },

    add(entity) {
      // A phase per member, off the engine's stream, so identical members never
      // move identically and a replay still matches.
      if (entity && entity._crowdPhase === undefined) entity._crowdPhase = context.random() * TAU
      return group.add(entity)
    },

    remove: entity => group.remove(entity),
    clear: () => group.clear(),
    index: () => group.index(),
    invalidate: () => group.invalidate(),
    near: (x, z, reach, into) => group.near(x, z, reach, into),
    nearest: (x, z, reach) => group.nearest(x, z, reach),

    drive,

    get stats() {
      return {
        ...group.stats,
        // The work, not the wall clock: two runs of the same seed must report
        // the same number here or it is noise rather than a measurement.
        neighbourTests: lastWork.pairs,
        drivenLastStep: lastWork.members
      }
    }
  }
}

/** Is there a target, with both of its axes as numbers? */
function aimed(towards, targetX, targetZ) {
  return towards != null && Number.isFinite(targetX) && Number.isFinite(targetZ)
}

/** One member's whole step: what it seeks, what pushes it, and where it ends up. */
function stepMember(flat, at, plan) {
  const member = flat.members[at]
  const seek = soughtHeading(flat, at, member, plan)
  const heading = wanderedHeading(seek, member, plan)
  const push = separationPush(flat, at, plan.span)
  const velocity = blendedVelocity(heading, push, member, plan)
  applyShove(flat, at, member, push, velocity, plan)
  return push.pairs
}

/**
 * The heading this member wants: its own committed line, the way to the target,
 * or nothing at all.
 *
 * `headingX`/`headingZ` on the entity mean committed: this one is charging, or
 * fleeing, or walking a line somebody else worked out, and it is not to be
 * steered. Without it the only way to take a member out of the seek is to take
 * it out of the group, and a group things join and leave every second cannot
 * keep a stable index.
 */
function soughtHeading(flat, at, member, plan) {
  const lockedX = member.headingX
  const lockedZ = member.headingZ
  const committed = !!(lockedX || lockedZ) && Number.isFinite(lockedX) && Number.isFinite(lockedZ)
  if (committed) {
    const length = Math.hypot(lockedX, lockedZ)
    return { headingX: lockedX / length, headingZ: lockedZ / length, committed }
  }
  if (!plan.hasTarget) return { headingX: 0, headingZ: 0, committed }
  const dx = plan.targetX - flat.positionX[at]
  const dz = plan.targetZ - flat.positionZ[at]
  const distance = Math.hypot(dx, dz)
  const arrived = distance <= 1e-6
  return { headingX: arrived ? 0 : dx / distance, headingZ: arrived ? 0 : dz / distance, committed }
}

/**
 * The heading after the wander angle, which keeps identical members off
 * identical lines. The phase is per member and drawn from the engine's stream,
 * so a replay wobbles the same way this run did. A committed member keeps its
 * line and is not turned.
 */
function wanderedHeading(seek, member, plan) {
  const wander = seek.committed ? 0 : (member.properties?.wander ?? 0)
  if (!wander) return seek
  const angle = Math.sin(plan.time * WANDER_RATE + (member._crowdPhase || 0)) * wander
  const cos = Math.cos(angle), sin = Math.sin(angle)
  const turnedX = seek.headingX * cos - seek.headingZ * sin
  const headingZ = seek.headingX * sin + seek.headingZ * cos
  return { headingX: turnedX, headingZ, committed: seek.committed }
}

/**
 * The velocity for a heading, with the separation blended in and the result
 * renormalised.
 *
 * A committed member keeps its line. It is still shoved out of bodies by
 * `applyShove` — going through another member is worse than a bent charge — but
 * nothing turns its heading.
 */
function blendedVelocity(heading, push, member, plan) {
  let headingX = heading.headingX
  let headingZ = heading.headingZ
  const pushLength = heading.committed ? 0 : Math.hypot(push.pushX, push.pushZ)
  if (pushLength > 1e-6) {
    headingX += (push.pushX / pushLength) * plan.separation
    headingZ += (push.pushZ / pushLength) * plan.separation
  }
  const length = Math.hypot(headingX, headingZ)
  if (length <= 1e-6) return { velocityX: 0, velocityZ: 0 }
  const speed = member.properties?.speed ?? plan.defaultSpeed
  return { velocityX: (headingX / length) * speed, velocityZ: (headingZ / length) * speed }
}

/**
 * Where the member ends up.
 *
 * Half the overlap each, because the other member resolves its own half on this
 * same pass, and capped so a body deep in a pile-up shuffles out rather than
 * teleporting across the map.
 */
function applyShove(flat, at, member, push, velocity, plan) {
  const limit = flat.radius[at] * 0.5
  let shoveX = push.pushX * plan.relax * 0.5
  let shoveZ = push.pushZ * plan.relax * 0.5
  const shove = Math.hypot(shoveX, shoveZ)
  if (shove > limit) { shoveX = (shoveX / shove) * limit; shoveZ = (shoveZ / shove) * limit }

  member.velocityX = velocity.velocityX
  member.velocityZ = velocity.velocityZ
  member.x = flat.positionX[at] + velocity.velocityX * plan.seconds + shoveX
  member.z = flat.positionZ[at] + velocity.velocityZ * plan.seconds + shoveZ
  // Rotation is degrees about +Y and a mesh faces -Z at zero, which is the
  // renderer's convention and the reason for the two minus signs.
  if (plan.face && (velocity.velocityX || velocity.velocityZ)) {
    member.rotation = Math.atan2(-velocity.velocityX, -velocity.velocityZ) * 180 / Math.PI
  }
}

/**
 * The push away from every neighbour one member overlaps, and the pairs tested
 * to find them.
 *
 * Only the cells within `span` of the member's own are walked, so the work
 * follows the crowd's density rather than its size. Two members exactly on top
 * of each other have no direction to part along; their wander phases differ, so
 * those are used rather than drawing a random number inside the hot loop.
 *
 * Read once per member, with the flat index the group handed out: the arrays are
 * reused and regrown, so nothing here may keep them.
 */
function separationPush(flat, at, span) {
  const { positionX, positionZ, radius, cellOf, order, cellStart, columns, rows, members } = flat
  const x = positionX[at]
  const z = positionZ[at]
  const own = radius[at]
  const column = cellOf[at] % columns
  const row = (cellOf[at] - column) / columns
  const fromColumn = Math.max(0, column - span), toColumn = Math.min(columns - 1, column + span)
  const fromRow = Math.max(0, row - span), toRow = Math.min(rows - 1, row + span)
  let pushX = 0, pushZ = 0, pairs = 0

  for (let r = fromRow; r <= toRow; r++) {
    const base = r * columns
    for (let c = fromColumn; c <= toColumn; c++) {
      const cell = base + c
      const end = cellStart[cell + 1]
      for (let k = cellStart[cell]; k < end; k++) {
        const j = order[k]
        if (j === at) continue
        const dx = x - positionX[j]
        const dz = z - positionZ[j]
        const range = own + radius[j]
        const squared = dx * dx + dz * dz
        pairs++
        if (squared >= range * range) continue
        let awayX = dx, awayZ = dz
        let distance = Math.sqrt(squared)
        if (distance < 1e-4) {
          // The two phases subtracted, not added: each member must be pushed
          // the opposite way to the other, or a coincident pair computes one
          // direction between them and travels together for ever.
          const angle = (members[at]._crowdPhase || 0) - (members[j]._crowdPhase || 0)
          awayX = Math.cos(angle); awayZ = Math.sin(angle); distance = 1e-4
        } else {
          awayX /= distance; awayZ /= distance
        }
        const overlap = range - distance
        pushX += awayX * overlap
        pushZ += awayZ * overlap
      }
    }
  }
  return { pushX, pushZ, pairs }
}

export default {
  name: 'Crowd',
  category: 'game',
  needs: ['Spatial Hash'],

  onLoad(context) {
    if (context.crowd) {
      console.error('[crowd] something else already put a crowd on context — replacing it')
    }

    context.crowd = groupRegistry((name, options) => makeCrowd(name, context, options))
  },

  commands: [{
    id: 'crowd.stats',
    label: 'What each crowd holds',
    run(context) {
      if (!context.crowd) return { error: 'Crowd did not load' }
      return { groups: context.crowd.groups.map(group => group.stats) }
    }
  }]
}
