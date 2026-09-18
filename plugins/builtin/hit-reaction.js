/**
 * Hit Reaction — what a thing does about being hit, as opposed to what it costs.
 *
 * Health decides the arithmetic and says so on the bus. This file is the whole
 * of the answer: a white flash, a shove, and a death that collapses instead of
 * a body that vanishes between two frames. None of it changes a number anyone
 * else reads, which is why it is a separate plugin — a game can turn all of it
 * off and still play exactly the same.
 *
 * The flash is a tint on the entity's own mesh, put back afterwards. That is
 * the only lever the renderer offers without a private material per entity, and
 * it costs one extra shared material per tint the game actually flashes — one,
 * in practice, because everything flashes the same white.
 *
 * The shove is written to velocity, not to position. A game with physics then
 * gets a body that slides and stops; a game without gets a step it can read and
 * apply itself. Writing position directly would push a body through a wall, and
 * the wall is the thing knockback is most fun against.
 */

import { asVector } from '../../engine/vector.js'

/** Seconds a hit stays white. Long enough to see at sixty frames, short enough to strobe. */
const FLASH = 0.09

/** What a hit flashes to. White reads as "that landed" on art of any colour. */
const FLASH_TINT = '#ffffff'

/** Entities currently flashing: entity -> { until, tint, had } */
const flashing = new Map()

/** Entities collapsing into their death: entity -> { until, from } */
const dying = new Map()

/**
 * Put a tint on, remembering exactly what was there.
 *
 * `had` is false when the mesh never declared a tint at all, because putting an
 * explicit tint back would quietly override the type's own colour from then on
 * — the entity would be very slightly the wrong shade forever, and nothing
 * would say why.
 */
function tint(entity, colour) {
  if (!entity.mesh || typeof entity.mesh !== 'object') return false
  entity.mesh = { ...entity.mesh, tint: colour }
  return true
}

function untint(entity, remembered) {
  if (!entity.mesh || typeof entity.mesh !== 'object') return
  const mesh = { ...entity.mesh }
  if (remembered.had) mesh.tint = remembered.tint
  else delete mesh.tint
  entity.mesh = mesh
}

export default {
  name: 'Hit Reaction',
  category: 'game',
  about: 'Flash, knockback and a death that collapses — the visible half of being hit.',
  needs: ['Health'],

  inspect: () => [{
    title: 'Hit Reaction',
    rows: [['flashing', flashing.size], ['dying', dying.size]]
  }],

  onLoad(context) {
    /**
     * Flash one thing white for a moment.
     *
     * Re-hitting something that is already white extends the flash rather than
     * remembering white as its colour — which is what a naive second call would
     * do, and the thing would stay white for the rest of the run.
     */
    function flash(entity, seconds = FLASH, colour = FLASH_TINT) {
      if (!entity?.mesh) return false
      const already = flashing.get(entity)
      if (already) {
        already.until = Math.max(already.until, context.time + seconds)
        return true
      }
      // A mesh written as the shorthand string is expanded first, or there is
      // nowhere to put a tint and the flash silently does nothing.
      if (typeof entity.mesh === 'string') entity.mesh = { texture: entity.mesh }
      const remembered = { until: context.time + seconds, tint: entity.mesh.tint, had: 'tint' in entity.mesh }
      if (!tint(entity, colour)) return false
      flashing.set(entity, remembered)
      return true
    }

    /**
     * Shove something away from a point, or along a direction.
     *
     * Flat on purpose: a top-down game that knocked things upward would spend
     * its hit reaction launching enemies over the arena wall.
     */
    function shove(entity, direction, metresPerSecond) {
      const push = asVector(direction)
      const speed = Number(metresPerSecond) || 0
      if (!push || !speed) return false
      const length = Math.hypot(push.x, push.z)
      if (!(length > 0)) return false
      entity.velocityX = (entity.velocityX || 0) + (push.x / length) * speed
      entity.velocityZ = (entity.velocityZ || 0) + (push.z / length) * speed
      return true
    }

    context.hitReaction = { flash, shove, get flashing() { return flashing.size } }

    context.bus.on('entity:hurt', event => {
      const victim = event?.entity
      if (!victim) return
      flash(victim, event.critical ? FLASH * 2 : FLASH)
      // Knockback is the weapon's number, passed through the damage call, so a
      // heavy weapon shoves and a fast one does not — and this file holds no
      // opinion about which is which.
      const push = Number(event.knockback) || 0
      if (push > 0) shove(victim, event.direction, push)
    })

    /**
     * A death that takes a moment.
     *
     * Health gives a body `linger` seconds before it removes it. This spends
     * them: the thing squashes flat and shrinks, which reads as a body falling
     * over on art that has no animation, and every survivor game in the genre
     * does some version of it.
     */
    context.bus.on('entity:killed', event => {
      const victim = event?.entity
      if (!victim) return
      const linger = Number(victim.damageable?.linger) || 0
      if (linger <= 0) return
      dying.set(victim, { started: context.time, until: context.time + linger, from: victim.scale ?? 1 })
      flash(victim, Math.min(linger, 0.12))
    })

    context.bus.on('level:loaded', () => { flashing.clear(); dying.clear() })
    context.bus.on('entity:removed', entity => { flashing.delete(entity); dying.delete(entity) })
  },

  systems: [{
    phase: 'fixed',
    run(world, seconds, context) {
      const at = context.time

      for (const [entity, remembered] of flashing) {
        if (at < remembered.until) continue
        flashing.delete(entity)
        // Something dying keeps its flash until it is gone — putting the colour
        // back on a corpse mid-collapse reads as the thing coming back to life.
        if (!dying.has(entity)) untint(entity, remembered)
      }

      for (const [entity, fall] of dying) {
        if (at >= fall.until) { dying.delete(entity); continue }
        // Written from the remembered start scale rather than multiplied down
        // each step, so a body that was already scaled collapses from its own
        // size and a paused frame does not shrink it twice.
        const through = (at - fall.started) / (fall.until - fall.started)
        entity.scale = fall.from * (1 - Math.max(0, Math.min(1, through)) * 0.85)
        entity.y -= seconds * 0.6
      }
    }
  }],

  commands: [{
    id: 'hits.flashing',
    label: 'What is flashing or collapsing',
    run: () => ({
      flashing: [...flashing.keys()].map(entity => entity.id),
      dying: [...dying.keys()].map(entity => entity.id)
    })
  }]
}
