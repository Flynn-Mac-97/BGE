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

    const { positionX, positionZ, radius, cellOf, order, cellStart, columns, rows, cellSize, members } = flat

    const towards = driveOptions.towards
    const targetX = towards?.x ?? 0
    const targetZ = towards?.z ?? 0
    const hasTarget = towards != null && Number.isFinite(targetX) && Number.isFinite(targetZ)
    const separation = driveOptions.separation ?? 1
    const relax = driveOptions.relax ?? DEFAULT_RELAX
    const face = driveOptions.face !== false
    const time = context.time
    let pairs = 0

    // Enough cells each way to cover the widest pair there is, whatever the
    // grid was re-cut to.
    const span = Math.max(1, Math.ceil((flat.widest * 2) / cellSize))

    for (let i = 0; i < count; i++) {
      const member = members[i]
      const x = positionX[i]
      const z = positionZ[i]
      const own = radius[i]
      const speed = member.properties?.speed ?? defaultSpeed

      let headingX = 0
      let headingZ = 0

      // `headingX`/`headingZ` on the entity mean committed: this one is
      // charging, or fleeing, or walking a line somebody else worked out, and
      // it is not to be steered. Without it the only way to take a member out
      // of the seek is to take it out of the group, and a group things join and
      // leave every second cannot keep a stable index.
      const lockedX = member.headingX
      const lockedZ = member.headingZ
      const committed = !!(lockedX || lockedZ) && Number.isFinite(lockedX) && Number.isFinite(lockedZ)

      if (committed) {
        const length = Math.hypot(lockedX, lockedZ)
        headingX = lockedX / length
        headingZ = lockedZ / length
      } else if (hasTarget) {
        const dx = targetX - x
        const dz = targetZ - z
        const distance = Math.hypot(dx, dz)
        if (distance > 1e-6) { headingX = dx / distance; headingZ = dz / distance }
      }

      // A wander angle keeps identical members off identical lines. The phase is
      // per member and drawn from the engine's stream, so a replay wobbles the
      // same way this run did.
      const wander = committed ? 0 : (member.properties?.wander ?? 0)
      if (wander) {
        const angle = Math.sin(time * WANDER_RATE + (member._crowdPhase || 0)) * wander
        const cos = Math.cos(angle), sin = Math.sin(angle)
        const turnedX = headingX * cos - headingZ * sin
        headingZ = headingX * sin + headingZ * cos
        headingX = turnedX
      }

      let pushX = 0, pushZ = 0
      const column = cellOf[i] % columns
      const row = (cellOf[i] - column) / columns
      const fromColumn = Math.max(0, column - span), toColumn = Math.min(columns - 1, column + span)
      const fromRow = Math.max(0, row - span), toRow = Math.min(rows - 1, row + span)

      for (let r = fromRow; r <= toRow; r++) {
        const base = r * columns
        for (let c = fromColumn; c <= toColumn; c++) {
          const cell = base + c
          const end = cellStart[cell + 1]
          for (let k = cellStart[cell]; k < end; k++) {
            const j = order[k]
            if (j === i) continue
            const dx = x - positionX[j]
            const dz = z - positionZ[j]
            const range = own + radius[j]
            const squared = dx * dx + dz * dz
            pairs++
            if (squared >= range * range) continue
            // Two members exactly on top of each other have no direction to
            // part along. Their wander phases differ, so use those rather than
            // drawing a random number inside the hot loop.
            let awayX = dx, awayZ = dz
            let distance = Math.sqrt(squared)
            if (distance < 1e-4) {
              const angle = (member._crowdPhase || 0) + (members[j]._crowdPhase || 0)
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

      // A committed member keeps its line. It is still shoved out of bodies
      // below — going through another member is worse than a bent charge — but
      // nothing turns its heading.
      const pushLength = committed ? 0 : Math.hypot(pushX, pushZ)
      if (pushLength > 1e-6) {
        headingX += (pushX / pushLength) * separation
        headingZ += (pushZ / pushLength) * separation
      }
      const headingLength = Math.hypot(headingX, headingZ)
      let velocityX = 0, velocityZ = 0
      if (headingLength > 1e-6) {
        velocityX = (headingX / headingLength) * speed
        velocityZ = (headingZ / headingLength) * speed
      }

      // Half the overlap each, because the other member resolves its own half
      // on this same pass, and capped so a body deep in a pile-up shuffles out
      // rather than teleporting across the map.
      const limit = own * 0.5
      let shoveX = pushX * relax * 0.5
      let shoveZ = pushZ * relax * 0.5
      const shove = Math.hypot(shoveX, shoveZ)
      if (shove > limit) { shoveX = (shoveX / shove) * limit; shoveZ = (shoveZ / shove) * limit }

      member.velocityX = velocityX
      member.velocityZ = velocityZ
      member.x = x + velocityX * seconds + shoveX
      member.z = z + velocityZ * seconds + shoveZ
      // Rotation is degrees about +Y and a mesh faces -Z at zero, which is the
      // renderer's convention and the reason for the two minus signs.
      if (face && (velocityX || velocityZ)) {
        member.rotation = Math.atan2(-velocityX, -velocityZ) * 180 / Math.PI
      }
    }

    // Everything moved, so the grid built at the top of this call is stale.
    // Saying so makes the next near() rebuild rather than answer from where
    // everything used to be.
    group.invalidate()
    lastWork = { pairs, members: count }
    return count
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

export default {
  name: 'Crowd',
  category: 'game',
  needs: ['Spatial Hash'],

  onLoad(context) {
    if (context.crowd) {
      console.error('[crowd] something else already put a crowd on context — replacing it')
    }

    const groups = new Map()

    context.crowd = {
      group(name, options) {
        const existing = groups.get(name)
        if (existing) return existing
        const made = makeCrowd(name, context, options)
        groups.set(name, made)
        return made
      },
      get: name => groups.get(name) || null,
      forget(name) {
        groups.get(name)?.clear()
        return groups.delete(name)
      },
      get groups() { return [...groups.values()] }
    }
  },

  commands: [{
    id: 'crowd.stats',
    label: 'What each crowd holds and what its last step cost',
    run(context) {
      if (!context.crowd) return { error: 'Crowd did not load' }
      return { groups: context.crowd.groups.map(group => group.stats) }
    }
  }]
}
