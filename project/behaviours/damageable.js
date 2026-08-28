/**
 * Damageable — everything about an entity that can be shot.
 *
 * The bag is the whole story, and the whole story is public: health, armour,
 * helmet, alive, team, lastHurtBy, blindUntil and blindAmount. A behaviour is
 * not allowed to look another one up, so this bag is how the rest of the game
 * agrees with it. Movement reads `entity.damageable.alive` before it reads
 * input. The bot reads it before it picks a target. Whatever draws the screen
 * reads `blindAmount`. None of them ask this file anything; they read a field.
 *
 * The arithmetic of a hit lives in project/plugins/damage.js, behind
 * `context.damage(entity, ...)`. That is deliberate: this file is the state and
 * that one is the rule, and there is exactly one of each.
 *
 * What this file does own is the one kind of damage nobody fires — the ground.
 */

/** Below this, a landing costs nothing. Roughly a two-metre drop. */
const FALL_SAFE_SPEED = 7

/**
 * And at this it kills outright, from full health with no armour.
 *
 * Armour is no help here on purpose: kevlar has never softened a landing in this
 * game, and a player who could buy their way out of a drop would take routes
 * that nobody else can follow.
 */
const FALL_FATAL_SPEED = 26

/** Said once each, because a missing plugin is missing on every frame. */
const alreadySaid = new Set()

function report(key, message) {
  if (alreadySaid.has(key)) return
  alreadySaid.add(key)
  console.error(`[damageable] ${message}`)
}

export default {
  about: 'health, armour, hitboxes and death — what it takes to kill this, and what is left afterwards',

  /**
   * Declared rather than set in start(), all eight of them, because the
   * generated index records a behaviour's default *values* — so anything that
   * needs to know the shape of this bag can read it without opening this file.
   * It also means `alive` is true from the moment the entity exists rather than
   * from the moment the level starts, and an `alive` that is briefly undefined
   * reads as dead to everything that checks it.
   */
  properties: {
    health: 100,
    armour: 0,
    helmet: false,
    // A copy for convenience. entity.properties.team is the one that is true;
    // this is refreshed from it at start.
    team: '',
    alive: true,
    // Who did it, where it landed and what with. The last hit is what a kill
    // feed is made of, and a feed built from a field on the victim cannot report
    // a kill that did not happen.
    lastHurtBy: null,
    lastHitbox: null,
    lastWeapon: null,
    // When the flash in this entity's eyes ends, in engine seconds, and how
    // white it was at its worst. Written by damage.flash, read by whatever
    // draws.
    blindUntil: 0,
    blindAmount: 0
  },

  start(entity, context, self) {
    if (entity.properties?.team) self.team = entity.properties.team

    // What a revive puts back, so the number a level author chose survives being
    // killed and does not quietly become 100.
    self.maxHealth = self.health
    self.alive = self.health > 0
    self.fallSpeed = 0
    self.diedAt = null

    if (!context.damage) {
      report('no-plugin',
        `${entity.id} can be damaged but project/plugins/damage.js is not loaded, so nothing will ever hurt it`)
    }
  },

  update(entity, seconds, context, self) {
    // The flash wears off on its own. Clearing both fields rather than leaving a
    // stale amount behind matters, because "blindAmount is 0.8" with a
    // blindUntil in the past is a screen nobody can see through and no way to
    // find out why.
    if (self.blindUntil && context.time >= self.blindUntil) {
      self.blindUntil = 0
      self.blindAmount = 0
    }

    if (self.alive === false) {
      // Physics only moves a "dynamic" body and a corpse is a trigger, so this
      // changes nothing today. It is here so that a body cannot be revived with
      // the velocity it died carrying and launch itself across the map.
      entity.velocityX = 0
      entity.velocityY = 0
      entity.velocityZ = 0
      return
    }

    fallDamage(entity, context, self)
  }
}

/**
 * The ground, as a weapon.
 *
 * Physics zeroes the vertical velocity on the step a body lands, so by the time
 * anything can notice the landing the speed that caused it is already gone. The
 * speed carried from the step before is therefore what a fall is measured by —
 * which is also why this is kept here in the bag rather than recomputed.
 */
function fallDamage(entity, context, self) {
  if (!entity.grounded) {
    self.fallSpeed = Math.max(0, -(entity.velocityY ?? 0))
    return
  }

  const speed = self.fallSpeed ?? 0
  self.fallSpeed = 0
  if (speed <= FALL_SAFE_SPEED) return

  const amount = 100 * (speed - FALL_SAFE_SPEED) / (FALL_FATAL_SPEED - FALL_SAFE_SPEED)
  if (!context.damage) {
    report('no-plugin-fall', `${entity.id} landed hard but there is no context.damage to tell about it`)
    return
  }
  // "world" rather than a weapon, the way Counter-Strike attributes a fall: the
  // map killed this one, and the kill feed should say so.
  context.damage(entity, { amount, hitbox: 'fall', weapon: 'world' })
}
