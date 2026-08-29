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

/** The ring, as multiples of how far the camera sees. Far enough that nobody watches a spawn arrive. */
const RING_NEAR = 1.15
const RING_FAR = 1.5

/** How far inside the edge of the meadow the ring is kept, and the narrowest ring worth having. */
const ARENA_INSET = 1.5
const SMALLEST_RING = 9

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
 * How much meadow there is, and whether it is big enough to hide a spawn behind.
 *
 * The ring wants to be a screen and a half out. If the grass does not reach
 * that far the horde would arrive walking on sky, which is worse than arriving
 * in view — so the ring is pulled in to fit the ground, and the fact is said
 * once with the number the arena would need. Silence would mean the arena lane
 * widening the meadow and nothing changing.
 *
 * Measured from the largest solid's drawn size rather than its collider,
 * because what a player reads as ground is the mesh.
 */
function fitToArena(context) {
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
  if (!widest) return widest

  // The ring has to fit inside the grass from wherever the player is standing,
  // and the player can stand at the edge. The honest radius is therefore the
  // shorter half-extent, not the diagonal.
  const room = Math.min(widest.halfWidth, widest.halfDepth) - ARENA_INSET
  if (room >= horde.ringFar) return widest

  horde.ringFar = Math.max(SMALLEST_RING, room)
  horde.ringNear = Math.max(SMALLEST_RING * 0.7, horde.ringFar - 8)
  horde.arenaTooSmall = true
  const seen = context.spawnRing.visibleRadius()
  console.error(
    `[horde] "${widest.id}" gives ${round(widest.halfWidth * 2)}m by ${round(widest.halfDepth * 2)}m of ground, ` +
    `so the spawn ring has been pulled in to ${round(horde.ringNear)}-${round(horde.ringFar)}m and enemies will ` +
    `appear in view. The camera sees ${round(seen)}m to a corner, so the meadow needs to be about ` +
    `${round(seen * 3)}m across for a survivor's crowd to arrive unseen.`
  )
  return widest
}

/** Gone, and worth something to whoever was killing it. */
function kill(context, entity, by) {
  if (!entity || entity._hordeOut) return false
  entity._hordeOut = true
  horde.killed++
  horde.killedByFamily[entity.type] = (horde.killedByFamily[entity.type] || 0) + 1
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
  context.world.destroy(entity)
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
        ['ring', `${stats.ring[0]}-${stats.ring[1]}m`],
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
      horde.killedByFamily = {}
      horde.floorTop = null
      horde.arena = undefined
      horde.arenaTooSmall = false
      horde.ringNear = context.spawnRing.visibleRadius() * RING_NEAR
      horde.ringFar = context.spawnRing.visibleRadius() * RING_FAR
    }

    horde = {
      crowd,
      born: 0,
      killed: 0,
      forgotten: 0,
      killedByFamily: {},
      floorTop: null,
      arena: undefined,
      arenaTooSmall: false,
      ringNear: 26,
      ringFar: 34,
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
      get ringNear() { fitToArena(context); return horde.ringNear },
      get ringFar() { fitToArena(context); return horde.ringFar },
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
          killedByFamily: horde.killedByFamily,
          forgotten: horde.forgotten,
          ring: [round(horde.ringNear), round(horde.ringFar)],
          // Said in the answer as well as on the console: the arena being too
          // small to hide a spawn is the one thing about this plugin that
          // another lane has to fix.
          arena: horde.arena
            ? {
                ground: [round(horde.arena.halfWidth * 2), round(horde.arena.halfDepth * 2)],
                bigEnough: !horde.arenaTooSmall,
                wantsAcross: round(context.spawnRing.visibleRadius() * 3)
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
      run: context => context.horde?.stats ?? { error: 'Horde did not load' }
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
