/**
 * Horde Drive — how the crowd moves once it is here.
 *
 * Everything walks at the kitten. That is the whole of the genre and it is not
 * negotiable: the moment an enemy can be out-thought rather than out-run, the
 * game becomes about something else. So there is no pathfinding here, no state
 * beyond one family's, and nothing that could make a rat interesting.
 *
 * What there is instead is the difference between a crowd and a queue.
 * Three hundred things seeking one point converge onto one line, and a line of
 * three hundred rats looks exactly like one rat. Crowd's separation is what
 * spreads them into a ring; this file only says how hard to push and gives
 * each family the small motion that makes it tellable apart at a glance:
 *
 *   crow, wasp   bob as they fly, at different rates and heights
 *   boar         stalks, braces, and charges in a locked straight line
 *   rat, hound   nothing. Two of the five must be plain or none of them read
 *
 * The order matters and it is visible in one place: flavour first, then one
 * pass over the whole crowd. Nothing here touches health, spawning or death —
 * those are the Horde plugin next door.
 */

/**
 * How hard a crowded enemy turns aside, against how hard it seeks.
 *
 * Above about 1.3 the horde stops closing and orbits; below about 0.7 it stacks
 * into a column and reads as one body. This is the number the whole look of the
 * game hangs on, and it is the first one to reach for if the crowd feels wrong.
 */
const SEPARATION = 1.05

/** How much of an overlap is pushed out per step, on top of the steering. */
const RELAX = 0.55

/** Flying families, and the bob that says so. Different rates, so a crow and a wasp never pulse together. */
const BOB = {
  crow: { rate: 6.5, amplitude: 0.13 },
  wasp: { rate: 12, amplitude: 0.2 }
}

/**
 * The boar's charge, in seconds and metres.
 *
 * The brace is the whole point. A boar that simply accelerated would be a fast
 * enemy; a boar that stops dead for four tenths of a second first is a thing
 * the player can read across a screen full of bodies and step out of. The range
 * is inside what the camera shows, or the tell happens off screen and the
 * charge is just damage out of nowhere.
 */
const CHARGE_RANGE = 13
const BRACE_SECONDS = 0.45
const CHARGE_SECONDS = 1.4
const REST_SECONDS = 1.7

/** What it does while bracing and while recovering, as a fraction of its stalking speed. */
const BRACE_SPEED = 0.12
const REST_SPEED = 0.45

/**
 * One boar, one step.
 *
 * The heading is locked at the moment the charge begins — written to
 * `headingX`/`headingZ`, which Crowd takes as "this member has already decided
 * where it is going" and stops steering. A charge that tracked the player would
 * be unavoidable, and an unavoidable attack is not a tell, it is a tax.
 */
function driveBoar(entity, context, target) {
  const properties = entity.properties
  if (entity._boarStalkSpeed === undefined) {
    entity._boarStalkSpeed = properties.speed
    entity._boarState = 'stalk'
    entity._boarUntil = 0
  }

  const state = entity._boarState
  const time = context.time

  if (state === 'stalk') {
    properties.speed = entity._boarStalkSpeed
    const distance = Math.hypot(target.x - entity.x, target.z - entity.z)
    if (distance <= CHARGE_RANGE) {
      entity._boarState = 'brace'
      entity._boarUntil = time + BRACE_SECONDS
    }
    return
  }

  if (state === 'brace') {
    properties.speed = entity._boarStalkSpeed * BRACE_SPEED
    if (time < entity._boarUntil) return
    const dx = target.x - entity.x
    const dz = target.z - entity.z
    const length = Math.hypot(dx, dz) || 1
    entity.headingX = dx / length
    entity.headingZ = dz / length
    entity._boarState = 'charge'
    entity._boarUntil = time + CHARGE_SECONDS
    return
  }

  if (state === 'charge') {
    properties.speed = properties.chargeSpeed ?? entity._boarStalkSpeed * 4
    if (time < entity._boarUntil) return
    entity.headingX = 0
    entity.headingZ = 0
    entity._boarState = 'rest'
    entity._boarUntil = time + REST_SECONDS
    return
  }

  properties.speed = entity._boarStalkSpeed * REST_SPEED
  if (time >= entity._boarUntil) entity._boarState = 'stalk'
}

export default {
  name: 'Horde Drive',
  // Horde Waves as well as Horde, so movement runs after spawning rather than
  // before it: the loader orders systems by these, and an enemy born this step
  // would otherwise stand still for a frame before anything steered it.
  needs: ['Horde', 'Horde Waves', 'Crowd'],
  about: 'How the horde moves: one pass over the whole crowd, plus the small motion that tells each family apart.',

  systems: [{
    phase: 'fixed',
    run(world, seconds, context) {
      const horde = context.horde
      if (!horde) return
      const crowd = horde.crowd
      if (!crowd.size) return
      const target = horde.target()
      if (!target) return

      for (const entity of crowd.members) {
        if (entity._hordeOut) continue
        const family = entity.properties.family
        if (family === 'boar') driveBoar(entity, context, target)

        // Height is the crowd's one blind spot on purpose — it moves things on
        // the ground plane and leaves y to whoever owns them. The bob is what
        // makes a flock of crows look airborne rather than skating.
        const bob = BOB[family]
        if (bob) {
          entity.y = (entity._hordeRestHeight ?? entity.y) +
            Math.sin(context.time * bob.rate + (entity._crowdPhase || 0)) * bob.amplitude
        }
      }

      crowd.drive(seconds, { towards: target, separation: SEPARATION, relax: RELAX })
    }
  }],

  commands: [{
    id: 'horde.spread',
    label: 'Is the crowd a crowd, or a queue',
    /**
     * The one measurement that says whether separation is working.
     *
     * A conga line and a ring have the same enemy count and the same distance
     * to the player, and look nothing alike. What tells them apart is how many
     * bodies are inside each other and how evenly the bearings are spread, so
     * that is what this reports rather than a screenshot.
     */
    run(context) {
      const horde = context.horde
      if (!horde) return { error: 'Horde did not load' }
      const members = horde.enemies
      const target = horde.target()
      if (!members.length || !target) return { alive: members.length, note: 'nothing on the meadow' }

      // Twelve buckets of thirty degrees around the player. An even crowd fills
      // most of them; a queue fills one.
      const bearings = new Array(12).fill(0)
      let overlapping = 0
      let deepest = 0
      let totalDistance = 0
      let nearest = Infinity
      let farthest = 0
      const scratch = []

      for (const entity of members) {
        const dx = entity.x - target.x
        const dz = entity.z - target.z
        const distance = Math.hypot(dx, dz)
        totalDistance += distance
        if (distance < nearest) nearest = distance
        if (distance > farthest) farthest = distance
        const bucket = Math.floor(((Math.atan2(dx, dz) + Math.PI) / (Math.PI * 2)) * 12) % 12
        bearings[bucket]++

        const radius = entity.properties.radius ?? 0.3
        for (const other of horde.near(entity.x, entity.z, radius * 2 + 1, scratch)) {
          if (other === entity) continue
          const range = radius + (other.properties.radius ?? 0.3)
          const apart = Math.hypot(other.x - entity.x, other.z - entity.z)
          if (apart >= range) continue
          overlapping++
          if (range - apart > deepest) deepest = range - apart
        }
      }

      return {
        alive: members.length,
        // Pairs, so each overlap was counted from both ends.
        overlappingPairs: Math.round(overlapping / 2),
        deepestOverlap: round(deepest),
        distanceToPlayer: { nearest: round(nearest), mean: round(totalDistance / members.length), farthest: round(farthest) },
        bearings,
        bearingsUsed: bearings.filter(n => n > 0).length,
        note: bearings.filter(n => n > 0).length >= 8
          ? 'spread around the player on most bearings — a crowd'
          : 'bunched onto a few bearings — check SEPARATION, or the horde has only just started arriving'
      }
    }
  }]
}

const round = n => Math.round(n * 1000) / 1000
