/**
 * Projectiles — things that fly, live for a while, and hurt what they touch.
 *
 * A projectile is a real entity, not a private record. That decision is worth
 * saying out loud: it costs a little more per shot, and it buys the renderer,
 * the inspector, the scene tree, `world.all('projectile')` and every other
 * lane's ability to see the thing without importing this file. A game with a
 * hundred shots in the air is not the game this engine is for; a game whose
 * bullets are invisible to its own tools is a game nobody can debug.
 *
 * No type file is needed. `world.spawn` takes the mesh and the properties from
 * the placement, so a builtin can put a drawable thing in the world without the
 * project having to declare one first — which matters, because the project that
 * wants bullets is exactly the project that has not written a bullet type yet.
 *
 * Hits are decided by distance between footprints, not by the physics solver.
 * A survivor, a twin-stick shooter and a bullet hell all agree that a shot hits
 * when the circles overlap, and none of them want a bullet resting on a floor.
 *
 * Movement is swept: a fast shot tests the whole segment it crossed this step,
 * so raising the speed never starts passing through people.
 */
import { radiusOf } from './health.js'

/** The type name a shot is spawned under, unless the caller names another. */
const KIND = 'projectile'

/** Live shots, in flight order. Kept here so the system does not walk the world. */
const flying = []

const asVector = value => {
  if (Array.isArray(value)) return { x: +value[0] || 0, y: +value[1] || 0, z: +value[2] || 0 }
  if (value && typeof value === 'object') return { x: +value.x || 0, y: +value.y || 0, z: +value.z || 0 }
  return null
}

function normalise(vector) {
  if (!vector) return null
  const length = Math.hypot(vector.x, vector.y, vector.z)
  if (!(length > 0)) return null
  return { x: vector.x / length, y: vector.y / length, z: vector.z / length }
}

/**
 * How close the shot came to a point over the step it just travelled.
 *
 * The squared distance from a point to the segment, which is the whole of swept
 * collision for two circles — and the reason a shot at forty metres a second
 * still hits something half a metre wide.
 */
function nearestOnSegment(from, to, point) {
  const dx = to.x - from.x, dz = to.z - from.z
  const length = dx * dx + dz * dz
  let along = 0
  if (length > 0) {
    along = ((point.x - from.x) * dx + (point.z - from.z) * dz) / length
    along = Math.max(0, Math.min(1, along))
  }
  const ox = from.x + dx * along - point.x
  const oz = from.z + dz * along - point.z
  return Math.hypot(ox, oz)
}

export default {
  name: 'Projectiles',
  category: 'game',
  about: 'Shots that fly, pierce, home and expire — swept hits against anything with health.',
  // Named so the damage verb is on context before the first shot lands, rather
  // than one plugin later. Every call into it is still guarded.
  needs: ['Health'],

  inspect: () => [{
    title: 'Projectiles',
    rows: [['in flight', flying.length], ['oldest', flying[0]?.entity?.id || '—']]
  }],

  onLoad(context) {
    /**
     * Put a shot in the air.
     *
     * @param shot  from      where it starts — an entity or a point
     *              direction which way it goes; normalised here
     *              speed     metres a second
     *              damage    what it takes off each thing it hits
     *              life      seconds before it expires, default 3
     *              radius    how wide it hits, default 0.25
     *              pierce    how many extra things it may hit, default 0
     *              knockback metres a second pushed back, passed to the hit
     *              homing    radians a second it may turn towards its target
     *              gravity   metres a second squared on Y, default 0
     *              spin      degrees a second it turns while drawn
     *              hits      test deciding what it may hit at all
     *              owner     who fired it; never hit, and named in the events
     *              source    the cooldown key a repeat hit is held under
     *              mesh      what it looks like; a small tinted box by default
     *              onHit     called with (target, result, shot) after damage
     *              onEnd     called with (shot, why) when it leaves the world
     * @returns the entity, so a caller may keep hold of it
     */
    function fire(shot = {}) {
      const origin = asVector(shot.from) || (shot.from ? { x: shot.from.x, y: shot.from.y, z: shot.from.z } : null)
      const direction = normalise(asVector(shot.direction))
      if (!origin || !direction) {
        console.error('[projectiles] a shot needs a "from" point and a "direction" — nothing was fired')
        return null
      }

      const radius = Number(shot.radius) || 0.25
      const size = radius * 2
      const entity = context.world.spawn(shot.type || KIND, {
        at: [origin.x, origin.y, origin.z],
        mesh: shot.mesh || { box: [size, size, size], tint: '#ffe6a8' },
        properties: { damage: Number(shot.damage) || 0, speed: Number(shot.speed) || 0 }
      })
      // Deliberately no collider: nothing may push a bullet, and a solid one
      // would stand on the floor it was fired over. Its hit size is the record.

      const record = {
        entity,
        direction,
        speed: Number(shot.speed) || 0,
        damage: Number(shot.damage) || 0,
        radius,
        gravity: Number(shot.gravity) || 0,
        spin: Number(shot.spin) || 0,
        pierce: Math.max(0, Math.round(Number(shot.pierce) || 0)),
        knockback: Number(shot.knockback) || 0,
        homing: Number(shot.homing) || 0,
        critical: shot.critical === true,
        every: Number(shot.every) || 0,
        source: shot.source || 'projectile',
        owner: shot.owner || null,
        hits: typeof shot.hits === 'function' ? shot.hits : null,
        onHit: typeof shot.onHit === 'function' ? shot.onHit : null,
        onEnd: typeof shot.onEnd === 'function' ? shot.onEnd : null,
        // Who it has already hit, so a piercing shot passes through a body once
        // rather than emptying it in a single step.
        struck: new Set(),
        expires: context.time + (Number(shot.life) || 3)
      }
      flying.push(record)

      context.bus.emit('weapon:fired', {
        entity: shot.owner || null,
        origin,
        direction,
        weapon: record.source,
        projectile: entity
      })
      return entity
    }

    context.projectiles = {
      fire,
      /** Every shot in the air, for a test or a panel. */
      get flying() { return flying.map(record => record.entity) },
      /** Retire everything. A level change and a cleared arena both want this. */
      clear() { for (const record of [...flying]) retire(record, 'cleared', context) },
      count: () => flying.length
    }

    context.bus.on('level:loaded', () => { flying.length = 0 })

    // Advance, test, damage. One system, because a shot that moved and a shot
    // that hit are the same shot on the same step, and splitting them puts a
    // frame of daylight between the bullet and the blood.
    context.projectiles.step = (seconds) => {
      const at = context.time
      for (const record of [...flying]) {
        const entity = record.entity
        if (!entity || record.expires <= at) { retire(record, 'expired', context); continue }

        if (record.homing > 0) turnTowards(record, seconds, context)

        const from = { x: entity.x, y: entity.y, z: entity.z }
        record.direction.y += record.gravity * seconds
        entity.x += record.direction.x * record.speed * seconds
        entity.y += record.direction.y * record.speed * seconds
        entity.z += record.direction.z * record.speed * seconds
        if (record.spin) entity.rotation = (entity.rotation || 0) + record.spin * seconds

        const to = { x: entity.x, y: entity.y, z: entity.z }
        hitWhatItTouched(record, from, to, context)
      }
    }
  },

  systems: [{
    phase: 'fixed',
    run: (world, seconds, context) => context.projectiles?.step(seconds)
  }],

  commands: [
    {
      id: 'projectiles.list',
      label: 'What is in the air',
      run: () => flying.map(record => ({
        id: record.entity.id,
        weapon: record.source,
        damage: record.damage,
        at: [round(record.entity.x), round(record.entity.y), round(record.entity.z)],
        pierce: record.pierce
      }))
    },
    {
      id: 'projectiles.clear',
      label: 'Take every shot out of the air',
      run: context => { context.projectiles.clear(); return { flying: flying.length } }
    }
  ]
}

/**
 * Bend a homing shot towards the nearest thing it is allowed to hit.
 *
 * Turning by a limited angle rather than snapping to the target is what makes
 * it read as a seeking missile instead of a laser that always connects — and it
 * lets a fast enemy outrun a slow one.
 */
function turnTowards(record, seconds, context) {
  const entity = record.entity
  const found = context.health?.nearest(entity, {
    hits: target => canHit(record, target),
    within: 30
  })
  if (!found) return

  const wanted = normalise({
    x: found.entity.x - entity.x,
    y: 0,
    z: found.entity.z - entity.z
  })
  if (!wanted) return

  const turn = record.homing * seconds
  const blended = normalise({
    x: record.direction.x + wanted.x * turn,
    y: record.direction.y,
    z: record.direction.z + wanted.z * turn
  })
  if (blended) record.direction = blended
}

/** Whether this shot is allowed to hurt this thing, before any geometry. */
function canHit(record, target) {
  if (!target || target === record.owner || target === record.entity) return false
  if (target.damageable?.alive === false) return false
  if (!target.damageable) return false
  if (record.struck.has(target)) return false
  if (record.hits && !record.hits(target)) return false
  return true
}

/** Everything the shot swept through this step, damaged in the order it met them. */
function hitWhatItTouched(record, from, to, context) {
  if (typeof context.damage !== 'function') return

  for (const target of context.world.entities) {
    if (!canHit(record, target)) continue
    const reach = record.radius + radiusOf(target)
    if (nearestOnSegment(from, to, target) > reach) continue

    record.struck.add(target)
    const point = { x: target.x, y: target.y + 0.2, z: target.z }
    const result = context.damage(target, record.damage, {
      from: record.owner,
      source: record.source,
      every: record.every,
      direction: record.direction,
      point,
      critical: record.critical,
      knockback: record.knockback
    })

    context.bus.emit('weapon:hit', {
      entity: record.owner,
      target,
      point,
      normal: { x: -record.direction.x, y: -record.direction.y, z: -record.direction.z },
      weapon: record.source,
      ...result
    })
    record.onHit?.(target, result, record)

    // Pierce is how many EXTRA bodies it may pass through, so a shot with none
    // stops on the first — which is what "pierce 0" has to mean or every number
    // above it is off by one.
    if (record.pierce > 0) { record.pierce--; continue }
    retire(record, 'hit', context)
    return
  }
}

/** Take a shot out of the air. `why` reaches `onEnd` and the bus. */
function retire(record, why, context) {
  const at = flying.indexOf(record)
  if (at < 0) return
  flying.splice(at, 1)
  record.onEnd?.(record, why)
  context.bus.emit('projectile:ended', { entity: record.entity, why, weapon: record.source })
  context.world.destroy(record.entity)
}

const round = n => Math.round(n * 1000) / 1000
