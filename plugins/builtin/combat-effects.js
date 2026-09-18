/**
 * Combat Effects — the standing translation of combat events into particles
 * and decals.
 *
 * Particles owns the machinery; this owns the wiring. `weapon:fired`,
 * `weapon:hit`, `entity:hurt` and `entity:killed` are the engine's combat
 * vocabulary — Projectiles and Health emit them — and `grenade:detonated`
 * and `explosion` are offered rather than agreed: if nothing emits them,
 * nothing happens. Every handler reads its event defensively and does
 * nothing when a field it wanted is missing; a missing muzzle position is a
 * shape decision somebody else made, not a fault worth shouting about every
 * shot.
 *
 * The look is still the game's. Effects fire BY NAME, so a game restyles
 * them with `particles.define` — a kitten game turns `blood` into a puff of
 * fur without touching this file — and decal art comes from
 * `context.particles.art`, which a game names in its own plugin.
 */

import { normalise, asWrittenVector } from '../../engine/vector.js'

export default {
  name: 'Combat Effects',
  category: 'game',
  about: 'Turns the engine\'s combat events — shots, hits, hurts, kills, blasts — into named particle effects and decals.',
  needs: ['Particles', 'Decals'],

  onLoad(context) {
    const particles = context.particles

    /**
     * Where each shooter's last shot left the barrel. The tracer is drawn
     * when the shot lands, because that is when its far end is known — and
     * `weapon:hit` need not carry where the shot came from.
     */
    const muzzles = new Map()
    context.bus.on('level:loaded', () => muzzles.clear())

    context.bus.on('weapon:fired', event => {
      const shooter = event?.entity
      const direction = normalise(asWrittenVector(event?.direction))
      const origin = asWrittenVector(event?.origin) || (shooter ? { x: shooter.x, y: shooter.y, z: shooter.z } : null)
      if (!origin || !direction) return

      if (shooter?.id) muzzles.set(shooter.id, origin)

      const at = { x: origin.x + direction.x * 0.3, y: origin.y + direction.y * 0.3, z: origin.z + direction.z * 0.3 }
      particles.effect('muzzle-flash', { at, direction })

      // Brass leaves to the shooter's right — the fire direction crossed with
      // up, no camera needed, so a bot ejects a case the same way you do.
      const right = normalise(cross(direction, { x: 0, y: 1, z: 0 }))
      if (right) {
        particles.effect('brass', {
          at: { x: origin.x + right.x * 0.15, y: origin.y - 0.05, z: origin.z + right.z * 0.15 },
          direction: { x: right.x + 0.2, y: 0.7, z: right.z + 0.2 }
        })
      }
    })

    // On this event `entity` is who fired and `target` is what they hit —
    // the naming the weapon plugins use throughout. The other way round
    // would put a bullet hole on the shooter.
    context.bus.on('weapon:hit', event => {
      const point = asWrittenVector(event?.point) || asWrittenVector(event?.at)
      if (!point) return
      const normal = normalise(asWrittenVector(event?.normal)) || { x: 0, y: 1, z: 0 }
      const target = event?.target

      // A tracer from muzzle to where the bullet stopped. The hit carries no
      // origin, so it comes from the shot that announced itself a moment ago.
      const from = asWrittenVector(event?.origin) || muzzles.get(event?.entity?.id)
      if (from) particles.effect('tracer', { at: from, to: point })

      if (isAlive(target)) {
        // A head shot sprays; a leg does not. The weapon plugin has already
        // worked out which, so nothing to decide here beyond how much.
        particles.effect('blood', {
          at: point,
          direction: { x: -normal.x, y: -normal.y, z: -normal.z },
          count: event?.hitbox === 'head' ? 26 : 14
        })
        // Blood lands under the wound rather than on the person: a decal is
        // stuck to the world, and a person walks away from it.
        context.decals?.place({
          at: { x: point.x, y: point.y - 1.2, z: point.z },
          normal: { x: 0, y: 1, z: 0 },
          size: [0.5, 0.5], texture: particles.art.blood, tint: '#8c1010',
          rotation: context.random() * Math.PI * 2,
          life: 25
        })
        return
      }

      const colour = surfaceColour(target)
      particles.effect('wall-hit', { at: point, direction: normal, colour })
      if (String(target?.mesh?.texture || '').includes('metal')) {
        particles.effect('sparks', { at: point, direction: normal })
      }
      context.decals?.place({
        at: point, normal, size: 0.09, texture: particles.art.bulletHole, tint: colour,
        // Turned at random about the normal so a wall of hits does not read
        // as a printed pattern. The randomness is the engine's — a replay
        // shows the same wall.
        rotation: context.random() * Math.PI * 2
      })
    })

    context.bus.on('entity:hurt', event => {
      const victim = event?.entity || event?.target
      if (!victim || !isAlive(victim)) return
      // No hit point on this event, so it goes at the chest — the one place
      // that is right for a hit from any direction.
      const direction = normalise(asWrittenVector(event?.direction))
      particles.effect('blood', {
        at: { x: victim.x, y: victim.y + 0.25, z: victim.z },
        count: 6,
        ...(direction ? { direction, spread: 0.8 } : {})
      })
    })

    context.bus.on('entity:killed', event => {
      const victim = event?.entity || event?.victim
      if (!victim) return
      particles.effect('blood', { at: { x: victim.x, y: victim.y + 0.2, z: victim.z }, count: 26, speed: [1, 4.5] })
      context.decals?.place({
        at: { x: victim.x, y: victim.y - 0.9, z: victim.z },
        normal: { x: 0, y: 1, z: 0 },
        size: [1.1, 1.1], texture: particles.art.blood, tint: '#7a0d0d',
        rotation: context.random() * Math.PI * 2,
        life: 40
      })
    })

    context.bus.on('grenade:detonated', event => {
      const at = asWrittenVector(event?.at) || asWrittenVector(event?.point)
      if (!at) return
      const kind = String(event?.kind || event?.weapon || '')
      if (kind.includes('smoke')) { particles.effect('smoke', { at }); return }
      if (kind.includes('flash')) { particles.effect('flash', { at }); return }
      particles.effect('explosion', { at, count: 120 })
    })

    context.bus.on('explosion', event => {
      const at = asWrittenVector(event?.at) || asWrittenVector(event?.point) || asWrittenVector(event?.entity)
      if (!at) return
      particles.effect('explosion', { at })
      context.decals?.place({
        at: { x: at.x, y: at.y - 0.4, z: at.z },
        normal: { x: 0, y: 1, z: 0 },
        size: [6, 6], texture: particles.art.blood, tint: '#2a2320',
        rotation: context.random() * Math.PI * 2
      })
    })
  }
}

/**
 * What a surface throws up when hit, by what its texture name says it is
 * made of. First match wins, so the longer name goes first: `sandstone`
 * would otherwise read as sand. A wall that declared its own tint is taken
 * at its word instead — see surfaceColour.
 */
const SURFACES = [
  ['sandstone', '#c9b489'],
  ['sand', '#cdba90'],
  ['tunnel', '#a89b86'],
  ['concrete', '#b6b2ab'],
  ['plaster', '#c3bcb0'],
  ['stairs', '#b0aaa0'],
  ['ceiling', '#8f8b84'],
  ['metal', '#d8dde3'],
  ['door', '#9aa0a8'],
  ['crate', '#9c7346'],
  ['wood', '#9c7346'],
  ['tarp', '#5f7f9c'],
  ['rug', '#7a2b2b'],
  ['roof', '#9c6a4a']
]

/**
 * The colour of what was hit. The texture name is trusted because a project
 * that named its file `sandstone-brick.png` has already said what it is —
 * making it say so twice is a second source of truth that can disagree.
 */
function surfaceColour(entity) {
  const tint = entity?.mesh?.tint
  if (typeof tint === 'string') return tint
  const texture = String(entity?.mesh?.texture || '').toLowerCase()
  for (const [match, colour] of SURFACES) if (texture.includes(match)) return colour
  return '#b9b2a4'
}

/** Anything that bleeds: a player or a bot, either of which carries a team. */
const isAlive = entity => !!(entity?.properties?.team || entity?.damageable)

// ------------------------------------------------------------------ small print
const cross = (a, b) => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x
})
