/**
 * Horde — the live crowd on the meadow, and the one place other lanes reach it.
 *
 * This plugin owns the enemies that exist: it admits them, it measures where
 * the ground and the spawn ring are, it kills them, and it hands out the
 * queries everything else needs. What arrives and when is Horde Waves; how it
 * moves is Horde Drive; what it costs to fight is Horde Schedule.
 *
 * Nothing was agreed with any other lane. Everything below is on `context`, and
 * an enemy whose `properties.health` is simply set to zero by somebody dies on
 * the next step anyway — the sweep trusts the number rather than the caller.
 *
 *     context.horde.near(x, z, radius, into)    who is in range of a weapon
 *     context.horde.nearest(x, z, radius)       the closest one
 *     context.horde.touching(entity, extra)     what is eating the kitten
 *     context.horde.hurt(entity, amount, by)    -> { killed, health }
 *     bus 'enemy:died' -> { entity, family, at, bounty, by }
 *     world.state.enemies, world.state.kills    so a HUD needs no wiring
 */

/** Who the horde walks at. A type name, so it survives the kitten being replaced. */
const HUNTED = 'kitten'

/** Where the ground is, when nothing solid is under the origin to measure against. */
const FLOOR_TOP_WHEN_UNKNOWN = 0.5

/**
 * Seconds a body stays on the meadow after it dies.
 *
 * Matches Health's own default linger, so a corpse this file takes away and one
 * Health takes away go at the same moment and a death reads the same either
 * way. It is long enough for the collapse to be seen and short enough that a
 * screen at the population cap never holds more corpses than enemies.
 */
const BODY_LINGER = 0.35

/**
 * The ring, as multiples of how far the frame reaches ON THAT BEARING.
 *
 * The screen is a trapezoid, not a circle: it reaches about 8m ahead of the
 * kitten, 4m behind it and 15m to a far corner. One radius that clears the
 * corner is twice the frame's reach ahead and four times its reach behind, so
 * most of the crowd is born well outside the picture and much of it dies before
 * it is ever in frame. A multiple of the EDGE clears the picture everywhere by
 * the same small margin, so an enemy is in frame a step or two after it is born.
 */
const RING_NEAR = 1.05
const RING_FAR = 1.14

/**
 * The nearest anything may be born, in metres, whatever the frame edge is on
 * that bearing.
 *
 * The frame reaches only about four metres behind the kitten, and the fastest
 * family covers 6.2 metres a second. This is about a second of a wasp's travel,
 * so nothing arrives as a hit with no warning.
 */
const LEAST_WARNING = 6.5

/** The least depth of the band once the floor has raised its near edge, so a cluster still arrives spread rather than on one line. */
const LEAST_BAND = 1.5

/** How far inside the edge of the meadow the ring is kept, and the narrowest ring worth having. */
const ARENA_INSET = 1.5
const SMALLEST_RING = 9

/** The Game Camera's own chase defaults and the engine's field of view, for a camera rule that leaves them unsaid. */
const CHASE_PITCH = -1.05
const CHASE_DISTANCE = 14
const FOV_WHEN_UNSAID = 90

/** The screen shape assumed when there is no viewport to measure. */
const ASPECT_WHEN_UNKNOWN = 16 / 9

let horde = null

/**
 * The top of whatever is under the middle of the arena.
 *
 * One ray, cached per level, rather than a constant — the arena lane raising or
 * thickening the meadow floor would otherwise leave the whole horde walking
 * through it.
 */
function floorTop(context) {
  if (horde.floorTop !== null) return horde.floorTop
  const hit = context.raycast?.(
    { x: 0, y: 200, z: 0 }, { x: 0, y: -1, z: 0 }, 400,
    { hit: entity => entity.properties?.body === 'solid' }
  )
  horde.floorTop = hit ? hit.point.y : FLOOR_TOP_WHEN_UNKNOWN
  return horde.floorTop
}

/**
 * The largest solid's drawn footprint, cached per level. Measured from the
 * mesh rather than the collider, because what a player reads as ground is
 * what is drawn.
 */
function widestGround(context) {
  if (horde.arena !== undefined) return horde.arena
  let widest = null
  for (const entity of context.world.entities) {
    if (entity.properties?.body !== 'solid') continue
    const box = entity.mesh?.box || entity.collider?.box
    if (!Array.isArray(box) || box.length !== 3) continue
    const scale = entity.scale ?? 1
    const halfWidth = (box[0] * scale) / 2
    const halfDepth = (box[2] * scale) / 2
    if (!widest || halfWidth * halfDepth > widest.halfWidth * widest.halfDepth) {
      widest = { x: entity.x, z: entity.z, halfWidth, halfDepth, id: entity.id }
    }
  }
  horde.arena = widest
  return widest
}

/**
 * The ground the PLAYER's camera shows, as a trapezoid measured from the body it
 * follows: metres forward to the top edge, back to the bottom edge, and the
 * half-width at each end.
 *
 * From the level's camera rule, never from the editor viewport, whose size is
 * whatever panel arrangement the author left. Only the viewport's SHAPE is read,
 * because the shape of the screen is part of that camera.
 *
 * Null until the rule has been read off disk, and null for a camera this sum
 * does not cover — the caller falls back to the engine's own estimate.
 */
function cameraFrame(context) {
  const rule = context.camera?.rule
  if (!rule || rule.mode !== 'third-person') return null
  const pitch = Math.abs(rule.pitch ?? CHASE_PITCH)
  const distance = rule.distance ?? CHASE_DISTANCE
  const halfVertical = ((rule.fov ?? FOV_WHEN_UNSAID) * Math.PI / 180) / 2
  const width = context.viewport?.width
  const height = context.viewport?.height
  const aspect = width > 0 && height > 0 ? width / height : ASPECT_WHEN_UNKNOWN
  const up = Math.tan(halfVertical)
  const side = up * aspect

  // The eye hangs behind and above the body. Each edge of the frame is one ray
  // from the eye to the ground; `sink` is how fast that ray falls, and the top
  // edge falls slowest, so it is the one that can miss the ground.
  const eyeHeight = distance * Math.sin(pitch) + (rule.offsetY ?? 0)
  const behind = distance * Math.cos(pitch)
  const sinkFar = Math.sin(pitch) - up * Math.cos(pitch)
  if (sinkFar <= 0) return null // the horizon is on screen, so there is no far edge
  const alongFar = eyeHeight / sinkFar
  const alongNear = eyeHeight / (Math.sin(pitch) + up * Math.cos(pitch))

  const frame = {
    yaw: rule.yaw ?? 0,
    forward: (Math.cos(pitch) + up * Math.sin(pitch)) * alongFar - behind,
    back: behind - (Math.cos(pitch) - up * Math.sin(pitch)) * alongNear,
    wideFar: side * alongFar,
    wideNear: side * alongNear
  }
  if (frame.forward <= 0 || frame.back <= 0) return null // the body is not in its own frame
  frame.corner = Math.hypot(frame.forward, frame.wideFar)
  return frame
}

/**
 * Metres from the body to the edge of the frame along one world bearing, as
 * `spawnRing` measures a bearing: 0 is +Z, turning toward +X.
 *
 * Four straight edges, so the answer is the nearest of the four crossings.
 * Screen up is -Z and screen right is +X at yaw 0, which is where the two
 * components come from.
 */
function edgeToward(frame, angle) {
  const local = angle - frame.yaw
  const ahead = -Math.cos(local)
  const across = Math.sin(local)
  const run = frame.forward + frame.back
  const rise = frame.wideFar - frame.wideNear
  const offset = run * frame.wideNear + rise * frame.back
  // Each edge as `a*ahead + b*across + c`, written so the body is on the
  // positive side of all four.
  const edges = [
    [-1, 0, frame.forward],
    [1, 0, frame.back],
    [rise, -run, offset],
    [rise, run, offset]
  ]
  let nearest = Infinity
  for (const [a, b, c] of edges) {
    const closing = -(a * ahead + b * across)
    if (closing <= 0) continue
    nearest = Math.min(nearest, c / closing)
  }
  return nearest
}

/**
 * What the camera shows, and how much of the ring the meadow has room for.
 *
 * Grass that does not reach the ring would have the horde arrive walking on sky,
 * so the ring is scaled to fit and the fact is said once with the width the
 * arena needs. Silence would mean the arena lane widening the meadow and
 * nothing changing.
 *
 * Cached only once the camera rule has produced a frame: the rule is read from
 * disk after `level:loaded`, and an estimate taken inside that gap must not
 * become the level's spawn distance.
 */
function measure(context) {
  if (horde.measured) return horde.measured
  const frame = cameraFrame(context)
  const seen = frame ? frame.corner : context.spawnRing.visibleRadius()
  let fit = 1

  // The ring has to fit inside the grass from wherever the player is standing,
  // and the player can stand at the edge. The honest radius is therefore the
  // shorter half-extent, not the diagonal.
  const widest = widestGround(context)
  const room = widest ? Math.min(widest.halfWidth, widest.halfDepth) - ARENA_INSET : Infinity
  const wanted = seen * RING_FAR
  if (room < wanted) {
    fit = Math.max(SMALLEST_RING, room) / wanted
    if (!horde.saidTooSmall) {
      horde.saidTooSmall = true
      console.error(
        `[horde] "${widest.id}" gives ${round(widest.halfWidth * 2)}m by ${round(widest.halfDepth * 2)}m of ground, ` +
        `so the spawn ring has been scaled to ${round(fit * 100)}% and enemies will appear well inside the frame. ` +
        `The player's camera sees ${round(seen)}m to a corner, so the meadow needs to be about ` +
        `${round(wanted * 2)}m across for the crowd to arrive from the edge of the picture.`
      )
    }
  }

  const measured = { frame, seen, fit, tooSmall: fit < 1 }
  if (frame) horde.measured = measured
  return measured
}

/** The band a spawn on this bearing lands in: just past the frame edge, held out to LEAST_WARNING, scaled to fit the meadow. */
function bandFor(edge, fit) {
  const near = Math.max(edge * RING_NEAR, LEAST_WARNING * fit)
  return { near, far: Math.max(edge * RING_FAR, near + LEAST_BAND) }
}

/** The band on one world bearing. */
function ringToward(context, angle) {
  const { frame, seen, fit } = measure(context)
  return bandFor((frame ? edgeToward(frame, angle) : seen) * fit, fit)
}

/** The widest band any bearing gives — the far corners. What recycling measures "definitely out of sight" against. */
function widestRing(context) {
  const { seen, fit } = measure(context)
  return bandFor(seen * fit, fit)
}

/**
 * Dead, and worth something to whoever was killing it.
 *
 * The body is not destroyed here. Health holds a corpse for its `linger` and
 * Hit Reaction spends those frames collapsing it; destroying on the step the
 * death landed cut that off, so every death in this game happened in one frame
 * and had to be carried by particles alone.
 *
 * The roster is the other half, and it changes here rather than when the body
 * goes: the enemy leaves the crowd at once, so a corpse neither steers nor
 * holds a place under the population cap.
 */
function kill(context, entity, by) {
  if (!entity || entity._hordeOut) return false
  entity._hordeOut = true
  horde.killed++
  horde.killedByFamily[entity.type] = (horde.killedByFamily[entity.type] || 0) + 1
  horde.crowd.remove(entity)
  // Announced before the entity goes, so a listener can still read where it was
  // standing and what it was. This is the seam the experience lane picks up.
  context.bus.emit('enemy:died', {
    entity,
    id: entity.id,
    family: entity.properties.family || entity.type,
    at: { x: entity.x, y: entity.y, z: entity.z },
    bounty: entity.properties.bounty ?? 1,
    by: by || null
  })
  // Health collects a body it declared dead. It never saw a death that only
  // set `properties.health` to zero, so that one is taken away here, after the
  // same wait — a body nobody removes would stand on the meadow all run.
  const pool = entity.damageable
  if (pool?.alive === false && pool.removeOnDeath !== false) return true
  context.after(BODY_LINGER, () => context.world.destroy(entity))
  return true
}

export default {
  name: 'Horde',
  needs: ['Crowd', 'Spawn Ring', 'Horde Schedule'],
  about: 'The live crowd on the meadow. Admits enemies, kills them, and answers every question another plugin has about them.',

  inspect: context => {
    const stats = context.horde?.stats
    if (!stats) return []
    return [{
      title: 'Horde',
      rows: [
        ['minute', stats.minute],
        ['alive', `${stats.alive} of ${stats.aliveCap}`],
        ['health', `${stats.healthScale}x`],
        ['killed', stats.killed],
        ['ring', `${stats.ring.ahead[0]}-${stats.ring.ahead[1]}m ahead, ${stats.ring.behind[0]}-${stats.ring.behind[1]}m behind`],
        ['families', Object.entries(stats.aliveByFamily).map(([f, n]) => `${f} ${n}`).join('  ') || '—']
      ]
    }]
  },

  onLoad(context) {
    if (context.horde) console.error('[horde] something else already put a horde on context — replacing it')

    const schedule = context.hordeSchedule
    // Cells about twice the widest enemy, so a neighbour walk is nine cells and
    // a hound still finds everything touching it.
    const crowd = context.crowd.group('horde', { cellSize: 1.6, radius: 0.32, speed: 2 })

    const begin = () => {
      crowd.clear()
      horde.born = 0
      horde.killed = 0
      horde.forgotten = 0
      horde.sentBack = 0
      horde.killedByFamily = {}
      horde.floorTop = null
      horde.arena = undefined
      horde.saidTooSmall = false
      // Null until `measure` reads the level's camera rule — measuring here
      // would race the rule coming off disk and win with the wrong number.
      horde.measured = null
    }

    horde = {
      crowd,
      born: 0,
      killed: 0,
      forgotten: 0,
      sentBack: 0,
      killedByFamily: {},
      floorTop: null,
      arena: undefined,
      saidTooSmall: false,
      measured: null,
      /** By type rather than by id, so the kitten lane may replace the entity and the horde follows. */
      target: () => context.world.find(HUNTED) || context.world.byId('you') || null
    }
    begin()
    context.bus.on('level:loaded', begin)

    const scratch = []

    context.horde = {
      crowd,
      families: schedule.families,
      get enemies() { return crowd.members },
      get count() { return crowd.size },
      get minutes() { return context.time / 60 },
      // The widest bearing, which is what "definitely out of sight" means. Where
      // a spawn actually lands is `ringToward`, because the frame is a trapezoid
      // and every bearing has its own edge.
      get ringNear() { return widestRing(context).near },
      get ringFar() { return widestRing(context).far },
      ringToward: angle => ringToward(context, angle),
      target: () => horde.target(),

      near: (x, z, radius, into) => crowd.near(x, z, radius, into),
      nearest: (x, z, radius) => crowd.nearest(x, z, radius),

      /**
       * Everything overlapping a body, its own radius included. This is the
       * question "is anything eating the kitten right now", and it is all the
       * kitten lane has to ask to take contact damage.
       */
      touching(entity, extra = 0) {
        if (!entity) return []
        const own = entity.properties?.radius ?? (entity.collider?.box?.[0] ?? 0.5) / 2
        const found = crowd.near(entity.x, entity.z, own + extra + 1, scratch)
        const out = []
        for (const other of found) {
          const range = own + extra + (other.properties?.radius ?? 0.3)
          if (Math.hypot(other.x - entity.x, other.z - entity.z) <= range) out.push(other)
        }
        return out
      },

      /** How many of each family are alive. */
      census() {
        const alive = {}
        for (const entity of crowd.members) {
          if (!entity._hordeOut) alive[entity.type] = (alive[entity.type] || 0) + 1
        }
        return alive
      },

      /**
       * Put one enemy of a family on the meadow, scaled to the minute.
       *
       * The only way in. Horde Waves decides which family and where; the health,
       * the speed, the resting height and the crowd membership are decided here,
       * so there is one description of what a live enemy is.
       */
      admit(family, x, z) {
        // world.spawn, not context.spawn: the latter announces `world:changed`,
        // the editor's "somebody edited the level" signal, which redraws every
        // dock and rebuilds one Scene row per entity. A horde spawning twenty
        // things a second is not an edit, and saying it was makes the editor
        // unusable while the game it is showing runs.
        const entity = context.world.spawn(family)
        const properties = entity.properties
        const minutes = context.time / 60

        const health = Math.max(1, Math.round(
          (properties.maxHealth ?? properties.health ?? 1) * schedule.healthScaleAt(minutes)))
        properties.maxHealth = health
        properties.health = health

        const faster = schedule.speedScaleAt(minutes)
        properties.speed = (properties.speed ?? 1) * faster
        // A boar's charge scales with its walk, or a late boar stalks quickly
        // and then charges at the speed it had in minute one.
        if (properties.chargeSpeed) properties.chargeSpeed *= faster

        const height = entity.collider?.box?.[1] ?? entity.mesh?.box?.[1] ?? 0
        entity.x = x
        entity.z = z
        entity.y = floorTop(context) + (height * (entity.scale ?? 1)) / 2 + (properties.hover || 0)
        entity._hordeRestHeight = entity.y
        crowd.add(entity)
        horde.born++
        return entity
      },

      /**
       * Move one enemy to a new place on the ring, keeping it alive.
       *
       * Destroying it and letting the drip send another costs a spawn the rate
       * has to pay for and leaves the crowd under its cap. This holds the
       * population exactly where the schedule set it. A locked heading is
       * cleared: a boar teleported mid-charge would go on charging at where the
       * kitten used to be.
       */
      sendBackIn(entity, x, z) {
        if (!entity || entity._hordeOut) return false
        entity.x = x
        entity.z = z
        entity.y = entity._hordeRestHeight ?? entity.y
        entity.headingX = 0
        entity.headingZ = 0
        horde.sentBack++
        return true
      },

      /** Taken away rather than killed. Nothing is owed for it — it was never fought. */
      forget(entity) {
        if (!entity || entity._hordeOut) return false
        entity._hordeOut = true
        horde.forgotten++
        context.world.destroy(entity)
        return true
      },

      /** Take health off one enemy, and kill it here rather than a step later, so a weapon that fires twice cannot spend its second shot on a corpse. */
      hurt(entity, amount, by) {
        if (!entity || entity._hordeOut) return null
        const properties = entity.properties
        properties.health = (properties.health ?? 0) - (amount || 0)
        entity._hordeKilledBy = by || null
        if (properties.health > 0) return { id: entity.id, health: properties.health, killed: false }
        kill(context, entity, by)
        return { id: entity.id, health: 0, killed: true }
      },

      kill: (entity, by) => kill(context, entity, by),

      clear() {
        for (const entity of [...crowd.members]) {
          entity._hordeOut = true
          context.world.destroy(entity)
        }
        crowd.clear()
      },

      get stats() {
        const minutes = context.time / 60
        const wave = schedule.waveAt(minutes)
        const { frame, seen, fit, tooSmall } = measure(context)
        // Bearings are given as a turn from the top of the screen, so the rows
        // below read the same whatever the camera's yaw is.
        const band = turn => {
          const one = ringToward(context, (frame?.yaw ?? 0) + Math.PI + turn)
          return [round(one.near), round(one.far)]
        }
        return {
          time: round(context.time),
          minute: round(minutes),
          alive: crowd.size,
          aliveCap: schedule.aliveCapAt(minutes),
          perSecond: round(schedule.rateAt(minutes)),
          healthScale: round(schedule.healthScaleAt(minutes)),
          speedScale: round(schedule.speedScaleAt(minutes)),
          wave: wave.minute,
          families: Object.keys(wave.weights),
          aliveByFamily: context.horde.census(),
          born: horde.born,
          killed: horde.killed,
          // Copied: the live map would go on counting until the caller printed
          // it, and a reading taken at ten seconds would show minute ten.
          killedByFamily: { ...horde.killedByFamily },
          forgotten: horde.forgotten,
          // How many times an enemy that fell out of the picture was moved back
          // to its edge. High is normal: the kitten outruns three of the five
          // families, so the slow ones are sent round rather than left behind.
          sentBack: horde.sentBack,
          // How far the player's camera sees, and the band just past its edge
          // that the crowd arrives on. Both from the level's camera rule, so
          // they are the same on every screen and in a headless run. The bands
          // differ by bearing because the frame does: `ahead` is the top of the
          // screen, `behind` the bottom, `corner` the farthest point of all.
          cameraSees: round(seen),
          frame: frame
            ? { ahead: round(frame.forward), behind: round(frame.back), side: round(edgeToward(frame, frame.yaw + Math.PI / 2)) }
            : null,
          ring: {
            ahead: band(0),
            behind: band(Math.PI),
            side: band(Math.PI / 2),
            corner: [round(widestRing(context).near), round(widestRing(context).far)]
          },
          // Said in the answer as well as on the console: the arena being too
          // small to hide a spawn is the one thing about this plugin that
          // another lane has to fix.
          arena: horde.arena
            ? {
                ground: [round(horde.arena.halfWidth * 2), round(horde.arena.halfDepth * 2)],
                bigEnough: !tooSmall,
                wantsAcross: round(seen * RING_FAR * 2)
              }
            : null
        }
      }
    }
  },

  systems: [{
    phase: 'fixed',
    /**
     * Death, once a step, before anything spawns or moves.
     *
     * The health is trusted rather than the caller: a weapon that only knows
     * how to subtract a number still kills things, and no plugin had to be told
     * about `hurt` for the game to work.
     */
    run(world, seconds, context) {
      if (!horde) return
      const members = horde.crowd.members
      for (let i = members.length - 1; i >= 0; i--) {
        const entity = members[i]
        if (entity._hordeOut) continue
        if ((entity.properties.health ?? 0) > 0) continue
        kill(context, entity, entity._hordeKilledBy || null)
      }
      world.state.enemies = horde.crowd.size
      world.state.kills = horde.killed
    }
  }],

  commands: [
    {
      id: 'horde.stats',
      label: 'What is on the meadow right now',
      run: async context => {
        if (!context.horde) return { error: 'Horde did not load' }
        // The ring is measured from the level's camera rule, which is read off
        // disk; wait for it so a headless run reports the played numbers.
        await context.camera?.ruleRead
        return context.horde.stats
      }
    },
    {
      id: 'horde.clear',
      label: 'Take everything off the meadow',
      run(context) {
        if (!context.horde) return { error: 'Horde did not load' }
        const was = context.horde.count
        context.horde.clear()
        return { removed: was, alive: context.horde.count }
      }
    }
  ]
}

const round = n => Math.round(n * 1000) / 1000
