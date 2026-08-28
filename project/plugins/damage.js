/**
 * Damage — the one way anything in this game loses health.
 *
 * Every bullet, every grenade and every long fall arrives at the same door:
 *
 *     context.damage(target, { amount, from, weapon, hitbox, direction, point })
 *
 * and the cases that are not a single ray arrive through the same door with a
 * different handle on it:
 *
 *     context.damage.blast(origin, { amount, radius, from, weapon })
 *     context.damage.flash(origin, { radius, duration, from })
 *     context.damage.revive(entity, { health, armour, helmet })
 *
 * One door, because armour, the hitbox multipliers, the death sound, the dropped
 * weapon and the kill feed all have to agree with each other, and the cheapest
 * way to make them agree is to give them nowhere else to be written.
 *
 * Where the numbers actually live is the `damageable` behaviour's own bag —
 * health, armour, helmet, alive, team, lastHurtBy. This plugin keeps no private
 * register of who is hurt, so an entity's health is readable from the entity and
 * nowhere else has a second opinion.
 */

// ---------------------------------------------------------------- the hitboxes
/**
 * A Counter-Strike player is one box, 0.81 x 1.83 x 0.81 m, with no skeleton in
 * it. Which body part a ray struck is therefore a question about height: how far
 * up the box, measured from the feet, the hit point sits.
 *
 * The multipliers are Counter-Strike's own, and they are the reason the game is
 * about crosshair placement at head height rather than about reflexes. Four
 * times damage for the top sixth of a man turns "aim at where a head will be"
 * into the entire skill of the game — an AK body shot needs three hits and a
 * head shot needs one, from the same trigger pull.
 */
const HITBOXES = [
  { name: 'head', above: 1.55, multiplier: 4.0 },
  { name: 'chest', above: 1.10, multiplier: 1.0 },
  { name: 'stomach', above: 0.75, multiplier: 1.25 },
  { name: 'legs', above: 0, multiplier: 0.75 }
]

/**
 * Every named hitbox, including the two that are not anatomy.
 *
 * `fall` and `blast` are hits on the whole body rather than on a part of it, so
 * they take the damage as it was given. They are here so that a caller naming
 * something this table has never heard of can be told about it.
 */
const MULTIPLIER = Object.fromEntries([
  ...HITBOXES.map(part => [part.name, part.multiplier]),
  ['fall', 1],
  ['blast', 1]
])

/**
 * The same body part, under the names the rest of the game calls it.
 *
 * A hitbox this file does not recognise falls back to a plain body hit at one
 * times damage, and a leg shot landing for four thirds of its proper damage is
 * exactly the kind of wrong that nobody ever notices and everybody feels. So the
 * singular and the plural are reconciled here rather than argued about between
 * two files that both think they are right.
 */
const ALIAS = { leg: 'legs', arm: 'chest', arms: 'chest', body: 'chest', torso: 'chest' }

/** The standing player, in metres. The hitbox heights above are measured against it. */
const STANDING_HEIGHT = 1.83

/** Eye height as a share of standing height, 1.62 of 1.83 — where a flash is seen from. */
const EYE_FRACTION = 1.62 / 1.83

// ------------------------------------------------------------------ the armour
/**
 * How much of what armour stopped is taken out of the armour itself.
 *
 * Half, which is Half-Life's own ARMOR_BONUS. It is the number that makes a
 * hundred points of kevlar wear out over a firefight rather than last one, and
 * that wearing-out is the whole point: "I had armour and it did nothing" is a
 * true report of the last few points of it, not a bug.
 */
const ARMOUR_BONUS = 0.5

/**
 * The share of a hit that gets through armour when the weapon does not say.
 *
 * A real weapon table carries its own `armourPenetration` — a pistol near 0.5,
 * an AK near 0.8 — and that spread is the reason armour is worth buying against
 * some guns and worth nothing against others.
 */
const DEFAULT_ARMOUR_PENETRATION = 0.5

// ------------------------------------------------------------------ the grenade
const BLAST_RADIUS = 7
const BLAST_DAMAGE = 98
const FLASH_RADIUS = 25
const FLASH_SECONDS = 3.5

/**
 * What a flashbang does to someone who is not looking at it.
 *
 * Not nothing. Turning your back on one still leaves the room white for a
 * moment, and a player who was fully protected by facing away would learn to
 * spin on a sound rather than to listen for the throw.
 */
const FLASH_FLOOR = 0.1

// -------------------------------------------------------------------- the body
/**
 * How tall a corpse is, and how far down it will look for a floor.
 *
 * A body on the ground is information — it is how you know a fight happened here
 * and roughly which way it went — so a killed entity is kept rather than
 * destroyed. But a body that is still a standing 1.83 m box stops bullets at
 * chest height for the rest of the round, and blocks a doorway besides. Laying
 * it flat on whatever is underneath fixes both, and it is also what a corpse
 * looks like.
 */
const CORPSE_HEIGHT = 0.35
const CORPSE_LOOK_DOWN = 30

// ------------------------------------------------------------------ the sounds
/**
 * Full paths, because a name with no slash in it resolves against project/assets
 * and these do not live there. The relative mix between these files was decided
 * when they were made, so nothing here passes a volume — doing so would quietly
 * undo it.
 */
const SOUNDS = {
  flesh: [
    'assets/counter-strike/sounds/hit-flesh-1.wav',
    'assets/counter-strike/sounds/hit-flesh-2.wav',
    'assets/counter-strike/sounds/hit-flesh-3.wav'
  ],
  helmet: 'assets/counter-strike/sounds/hit-helmet.wav',
  kevlar: 'assets/counter-strike/sounds/armor-hit.wav',
  hurt: [
    'assets/counter-strike/sounds/hurt-1.wav',
    'assets/counter-strike/sounds/hurt-2.wav',
    'assets/counter-strike/sounds/hurt-3.wav'
  ],
  death: [
    'assets/counter-strike/sounds/death-1.wav',
    'assets/counter-strike/sounds/death-2.wav'
  ]
}

// ------------------------------------------------------------------- reporting
/** Said once each, because a wrong hitbox name is wrong on every shot of the round. */
const alreadySaid = new Set()

function report(key, message) {
  if (alreadySaid.has(key)) return
  alreadySaid.add(key)
  console.error(`[damage] ${message}`)
}

// ------------------------------------------------------------- the pure part
/**
 * Which body part a point struck, given the box it struck.
 *
 * Measured from the feet and then scaled onto a standing player, so a crouched
 * box — 0.91 m, half the height — still has a head at the top of it rather than
 * being all head. Getting that wrong makes crouching either invulnerable or
 * fatal, and both are worse than the arithmetic.
 *
 * Scaled by one multiplication rather than by dividing and multiplying back,
 * because a standing body then scales by exactly 1.0 and a hit on the 1.55 m
 * line lands on the side of it that the number says.
 */
export function hitboxAt(entity, point) {
  const box = entity?.collider?.box
  if (!point || !Array.isArray(box) || box.length !== 3) return 'chest'

  const height = box[1] * (entity.scale ?? 1)
  if (!(height > 0)) return 'chest'

  const feet = entity.y - height / 2
  const fromFeet = clamp(point.y - feet, 0, height) * (STANDING_HEIGHT / height)
  return (HITBOXES.find(part => fromFeet >= part.above) ?? HITBOXES[HITBOXES.length - 1]).name
}

/**
 * One hit against armour: what gets through, what the armour absorbed, and what
 * is left of the armour afterwards.
 *
 * The interesting branch is the second one. When the armour cannot pay for
 * everything it would have stopped it stops only what it could afford and the
 * rest lands on flesh, which is how a plate runs out in the middle of a burst.
 * Exported because it is pure arithmetic and a test should be able to check the
 * formula without staging a gunfight to do it.
 */
export function armourAfter(amount, armour, penetration) {
  const through = amount * penetration
  const absorbed = (amount - through) * ARMOUR_BONUS

  if (absorbed >= armour) {
    return { through: amount - armour / ARMOUR_BONUS, absorbed: armour, armour: 0 }
  }
  return { through, absorbed, armour: armour - absorbed }
}

/**
 * Kevlar covers the torso and the arms. Only a helmet covers the head, and
 * nothing in Counter-Strike has ever covered the legs — which is why a leg shot
 * is the one place a rich player and a poor one take the same damage.
 *
 * A fall is not something armour can be worn against.
 */
export function armourCovers(hitbox, helmet) {
  if (hitbox === 'head') return helmet === true
  if (hitbox === 'legs' || hitbox === 'fall') return false
  return true
}

// ------------------------------------------------------------------ the plugin
/**
 * The context this plugin was loaded with.
 *
 * A test is handed `test` and never `context`, so without this the only way to
 * check a blast, a flash or a kill event would be to build a fake world to fire
 * into — and a fake is exactly the thing that stops agreeing with the real one
 * the week after it is written. Nothing in the game reads this.
 */
let engineContext = null
export const contextInUse = () => engineContext

export default {
  name: 'Damage',

  // The ray decides what is behind a wall and the sound set says what a hit
  // sounds like. Neither is called before a shot is fired, so this is an order
  // rather than a requirement — but the order is worth writing down.
  needs: ['Physics 3D', 'Sound'],

  onLoad(context) {
    engineContext = context

    if (context.damage) {
      console.error('[damage] something else already put a damage() on context — replacing it')
    }

    /**
     * Hurt something. The entry point every shooter, every trap and every fall
     * in the game goes through.
     *
     * `hitbox` may be named outright, or left out and worked out from `point` —
     * pass the `point` a raycast returned and the body part comes free.
     *
     * Returns what happened, or null if nothing could: an unknown target, a
     * target with nothing to hurt, or one that is already dead.
     */
    function damage(target, options = {}) {
      const entity = asEntity(target)
      if (!entity) return null

      const self = entity.damageable
      if (!self) {
        report(`bag-${entity.type}`,
          `${entity.id} was damaged but its type has no "damageable" behaviour, so nothing happened — attach one`)
        return null
      }
      // Already dead. Shooting a corpse is allowed and costs it nothing, which
      // is also what stops one burst from killing the same player twice.
      if (self.alive === false) return null

      const named = options.hitbox || hitboxAt(entity, options.point)
      const hitbox = ALIAS[named] ?? named
      if (MULTIPLIER[hitbox] === undefined) {
        report(`hitbox-${hitbox}`,
          `"${hitbox}" is not a hitbox — expected one of ${Object.keys(MULTIPLIER).join(', ')}; treating it as a body hit`)
      }

      const headshot = hitbox === 'head'
      const helmetBefore = self.helmet === true
      let amount = Math.max(0, options.amount ?? 0) * (MULTIPLIER[hitbox] ?? 1)
      let absorbed = 0

      if (amount > 0 && (self.armour ?? 0) > 0 && armourCovers(hitbox, helmetBefore)) {
        const after = armourAfter(amount, self.armour, penetrationOf(options))
        amount = after.through
        absorbed = after.absorbed
        self.armour = round(after.armour)

        // A helmet is good for one head shot. It either saves the wearer and is
        // finished, or it does not — and either way the second shot is bare.
        if (headshot && absorbed > 0) self.helmet = false
      }

      self.health = round((self.health ?? 0) - amount)
      // The record of the last hit, left on the victim. A kill feed built by
      // watching a field on the body cannot report a kill that did not happen,
      // and it needs no event from anybody to do it.
      self.lastHitbox = hitbox
      self.lastWeapon = typeof options.weapon === 'string' ? options.weapon : (options.weapon?.id ?? null)
      if (options.from) self.lastHurtBy = options.from

      const killed = self.health <= 0
      playHurt(entity, { hitbox, absorbed, helmetBefore, killed })

      context.bus.emit('entity:hurt', {
        entity,
        amount: round(amount),
        absorbed: round(absorbed),
        hitbox,
        headshot,
        from: options.from ?? null,
        weapon: options.weapon ?? null,
        direction: options.direction ?? null,
        health: self.health,
        armour: self.armour
      })

      if (killed) die(entity, self, { ...options, hitbox, headshot })

      return {
        entity,
        hitbox,
        headshot,
        amount: round(amount),
        absorbed: round(absorbed),
        health: self.health,
        armour: self.armour,
        killed
      }
    }

    /**
     * What happens after the last point of health.
     *
     * The entity is not destroyed. It stops answering to input — which the rest
     * of the game reads as `entity.damageable.alive` — drops what it was
     * holding, stops being something you can walk into, and lies down where it
     * fell. It is still there at the end of the round because a body is the
     * clearest record this game keeps of what happened where.
     */
    function die(entity, self, options) {
      self.alive = false
      self.health = 0
      self.diedAt = context.time
      self.blindUntil = 0
      self.blindAmount = 0
      entity.velocityX = 0
      entity.velocityY = 0
      entity.velocityZ = 0

      // Dropped before the body is laid down, so the weapon lands where the
      // player was standing rather than under the corpse. Asked of the carrier's
      // own bag first — a plain field read, which is the one way two behaviours
      // are allowed to agree — because something with no inventory at all has
      // nothing to drop and should not be told off for it.
      if (entity.carriesWeapons && context.weapons?.drop) {
        try { context.weapons.drop(entity) }
        catch (e) { console.error(`[damage] ${entity.id} could not drop its weapon —`, e) }
      }

      layDown(entity, self)
      context.play?.(context.random.pick(SOUNDS.death), { entity })

      context.bus.emit('entity:killed', {
        // `victim` is the name the game's own contract uses and `entity` is what
        // every other event on this bus calls its subject. Both are here because
        // a kill feed that silently never fires is worse than one extra key.
        victim: entity,
        entity,
        killer: options.from ?? null,
        weapon: options.weapon ?? null,
        headshot: !!options.headshot,
        hitbox: options.hitbox
      })

      if (context.match?.killed) {
        try { context.match.killed(entity, options.from ?? null, options.weapon ?? null, !!options.headshot) }
        catch (e) { console.error(`[damage] match.killed threw for ${entity.id} —`, e) }
      }
    }

    /**
     * Flatten the body and drop it onto whatever is underneath.
     *
     * "trigger" is what makes it non-solid: physics pushes nothing out of a
     * trigger, so a corpse in a doorway is scenery rather than a wall. The
     * flattening is for the ray — a standing box would keep stopping bullets at
     * chest height, and the shooter would have no idea why.
     */
    function layDown(entity, self) {
      self.bodyWas = entity.properties?.body ?? null
      self.colliderWas = entity.collider
      if (entity.properties) entity.properties.body = 'trigger'

      const box = entity.collider?.box
      if (!Array.isArray(box) || box.length !== 3) return

      const scale = entity.scale ?? 1
      const feet = entity.y - (box[1] * scale) / 2
      entity.collider = { box: [box[0], CORPSE_HEIGHT / scale, box[2]] }

      const floor = context.raycast?.(
        { x: entity.x, y: entity.y, z: entity.z },
        { x: 0, y: -1, z: 0 },
        CORPSE_LOOK_DOWN,
        { ignore: [entity] }
      )
      entity.y = (floor ? floor.point.y : feet) + CORPSE_HEIGHT / 2
    }

    /**
     * Put someone back on their feet — the other end of the round from die().
     *
     * Everything death took is given back: the collider it had, the body it was,
     * a clean health bar and no flash in the eyes. The match rules call this at
     * the start of a round; nothing else should need to.
     */
    function revive(target, options = {}) {
      const entity = asEntity(target)
      const self = entity?.damageable
      if (!self) return null

      self.health = options.health ?? self.maxHealth ?? 100
      self.armour = options.armour ?? 0
      self.helmet = options.helmet ?? false
      self.alive = true
      self.lastHurtBy = null
      self.lastHitbox = null
      self.lastWeapon = null
      self.blindUntil = 0
      self.blindAmount = 0
      self.fallSpeed = 0
      self.diedAt = null

      // Stood back up from where the body was lying. Putting a full-height
      // collider back around a centre that is half in the floor would leave
      // physics to shove the revived player out of it sideways, which is how a
      // respawn ends up somewhere nobody chose.
      if (self.colliderWas) {
        const feet = entity.y - CORPSE_HEIGHT / 2
        entity.collider = self.colliderWas
        const box = self.colliderWas.box
        if (Array.isArray(box) && box.length === 3) entity.y = feet + (box[1] * (entity.scale ?? 1)) / 2
      }
      if (self.bodyWas && entity.properties) entity.properties.body = self.bodyWas
      self.colliderWas = null
      self.bodyWas = null

      context.bus.emit('entity:revived', { entity })
      return self
    }

    /**
     * A grenade: damage from a point in space rather than along a ray.
     *
     * Two things make it different from a bullet. It falls off with distance, so
     * where you were standing matters more than where you were looking, and it
     * is stopped by walls — checked with one ray from the blast to each victim,
     * which is why hiding behind a crate works and hiding behind a friend does
     * not.
     */
    function blast(origin, options = {}) {
      const at = asVector(origin)
      if (!at) {
        report('blast-origin', 'damage.blast needs an origin of { x, y, z }')
        return []
      }

      const radius = options.radius ?? BLAST_RADIUS
      const peak = options.amount ?? BLAST_DAMAGE
      const hurt = []

      for (const entity of [...context.world.entities]) {
        const self = entity.damageable
        if (!self || self.alive === false) continue

        const middle = middleOf(entity)
        const away = minus(middle, at)
        const distance = lengthOf(away)
        if (distance > radius) continue
        if (blockedBetween(at, middle, entity)) continue

        const amount = peak * (1 - distance / radius)
        if (amount <= 0) continue

        const result = damage(entity, {
          amount,
          hitbox: 'blast',
          from: options.from ?? null,
          weapon: options.weapon ?? null,
          armourPenetration: options.armourPenetration,
          direction: distance > 1e-6 ? scaled(away, 1 / distance) : { x: 0, y: 1, z: 0 }
        })
        if (result) hurt.push(result)
      }
      return hurt
    }

    /**
     * A flashbang: no damage at all, and the loudest thing in the round anyway.
     *
     * Two things decide how badly it lands — how near you were and how far off
     * your aim it went off. Both are needed: distance alone would blind a player
     * staring at a wall as hard as one staring at the grenade, and that is the
     * difference between a flash you can play around and one you cannot.
     *
     * The result is left on the victim as `blindUntil` and `blindAmount` for
     * whatever draws the screen to read. Nothing here draws anything.
     */
    function flash(origin, options = {}) {
      const at = asVector(origin)
      if (!at) {
        report('flash-origin', 'damage.flash needs an origin of { x, y, z }')
        return []
      }

      const radius = options.radius ?? FLASH_RADIUS
      const seconds = options.duration ?? FLASH_SECONDS
      const blinded = []

      for (const entity of [...context.world.entities]) {
        const self = entity.damageable
        if (!self || self.alive === false) continue

        const eye = eyeOf(entity)
        const away = minus(eye, at)
        const distance = lengthOf(away)
        if (distance > radius) continue
        if (blockedBetween(at, eye, entity)) continue

        const looking = lookDirection(entity)
        const toward = distance > 1e-6 ? scaled(away, -1 / distance) : { x: 0, y: 0, z: -1 }
        // -1 with your back to it, +1 staring straight at it. Mapped onto a
        // floor-to-one range rather than zero-to-one, because facing away is a
        // reduction and not an immunity.
        const alignment = looking ? dot(looking, toward) : -1
        const facing = FLASH_FLOOR + (1 - FLASH_FLOOR) * clamp((alignment + 1) / 2, 0, 1)

        const amount = round(clamp((1 - distance / radius) * facing, 0, 1))
        if (amount <= 0.02) continue

        // A second flash while the first is still in your eyes is not a reset.
        // Whichever is worse, and whichever lasts longer, is the one that counts.
        self.blindAmount = Math.max(self.blindAmount ?? 0, amount)
        self.blindUntil = Math.max(self.blindUntil ?? 0, round(context.time + seconds * amount))

        context.bus.emit('entity:blinded', {
          entity, amount, until: self.blindUntil, from: options.from ?? null
        })
        blinded.push({ entity, amount, until: self.blindUntil })
      }
      return blinded
    }

    // ------------------------------------------------------------- the details
    const asEntity = target => {
      if (!target) return null
      if (typeof target === 'string') {
        const found = context.world.byId(target)
        if (!found) report(`missing-${target}`, `nothing here is called "${target}", so it cannot be damaged`)
        return found ?? null
      }
      return target.id ? target : null
    }

    /**
     * How much of a hit this weapon puts through armour.
     *
     * The weapon table owns the number; an explicit `armourPenetration` on the
     * call overrides it, which is what lets a trap or a test say what it means
     * without inventing a weapon to say it with.
     */
    function penetrationOf(options) {
      if (typeof options.armourPenetration === 'number') return clamp(options.armourPenetration, 0, 1)

      const weapon = weaponNamed(options.weapon)
      if (typeof weapon?.armourPenetration === 'number') return clamp(weapon.armourPenetration, 0, 1)
      if (weapon) {
        report('armour-penetration',
          `the weapon table carries no armourPenetration, so every hit is using the default of ${DEFAULT_ARMOUR_PENETRATION}`)
      }
      return DEFAULT_ARMOUR_PENETRATION
    }

    function weaponNamed(weapon) {
      if (!weapon) return null
      if (typeof weapon === 'object') return weapon
      try { return context.weapons?.get?.(weapon) ?? context.weapons?.table?.[weapon] ?? null }
      catch (e) { report('weapon-table', `could not read the weapon table — ${e.message}`); return null }
    }

    /**
     * The impact, and then the man.
     *
     * A helmet rings, kevlar thuds and flesh does neither, and telling them apart
     * by ear is how a shooter knows to keep firing at a body rather than switch
     * targets. A fall makes no impact sound because nothing hit the player but
     * the floor.
     */
    function playHurt(entity, { hitbox, absorbed, helmetBefore, killed }) {
      if (hitbox !== 'fall') {
        const impact = hitbox === 'head' && helmetBefore && absorbed > 0 ? SOUNDS.helmet
          : absorbed > 0 ? SOUNDS.kevlar
            : context.random.pick(SOUNDS.flesh)
        context.play?.(impact, { entity })
      }
      if (!killed) context.play?.(context.random.pick(SOUNDS.hurt), { entity })
    }

    /** Is there a wall on the line between these two points? */
    function blockedBetween(from, to, victim) {
      if (!context.raycast) return false
      const along = minus(to, from)
      const distance = lengthOf(along)
      if (distance < 1e-6) return false

      return !!context.raycast(from, scaled(along, 1 / distance), distance, {
        ignore: [victim],
        // Only the map stops a blast. Standing behind a team-mate has never been
        // cover in this game and should not start being cover here.
        hit: candidate => candidate.properties?.body === 'solid'
      })
    }

    /**
     * Where this entity is looking.
     *
     * `entity.yaw` and `entity.pitch` when it keeps its own aim — a plain field,
     * which is the only way two behaviours are allowed to agree — and the
     * camera's aim otherwise, because the entity the camera is on is the one
     * whose look is in the view rather than on the entity.
     */
    function lookDirection(entity) {
      let yaw = entity.yaw
      let pitch = entity.pitch
      if (typeof yaw !== 'number') {
        const aim = context.camera?.aim?.()
        if (!aim) return null
        yaw = aim.yaw
        if (typeof pitch !== 'number') pitch = aim.pitch
      }
      const flat = Math.cos(pitch ?? 0)
      return { x: -Math.sin(yaw) * flat, y: Math.sin(pitch ?? 0), z: -Math.cos(yaw) * flat }
    }

    Object.assign(damage, { blast, flash, revive, hitboxAt, armourAfter, armourCovers })
    context.damage = damage

    // A new level is a new set of entities under the same ids, and a fault
    // already reported belongs to the last one. Saying it again for the new
    // world is the point.
    context.bus.on('level:loaded', () => alreadySaid.clear())
  },

  commands: [
    {
      id: 'damage.state',
      label: 'Who is alive, and how alive',
      run: context => context.world.entities
        .filter(entity => entity.damageable)
        .map(entity => ({
          id: entity.id,
          team: entity.damageable.team || entity.properties?.team || null,
          health: entity.damageable.health,
          armour: entity.damageable.armour,
          helmet: entity.damageable.helmet,
          alive: entity.damageable.alive !== false,
          blindUntil: entity.damageable.blindUntil || 0
        }))
    },
    {
      // run damage.hurt '["player-0", 36, "head"]'
      id: 'damage.hurt',
      label: 'Hurt one entity',
      run: (context, args) => {
        const [id, amount = 10, hitbox = 'chest'] = Array.isArray(args) ? args : [args]
        return context.damage(id, { amount, hitbox }) ?? { error: `nothing damageable called "${id}"` }
      }
    },
    {
      id: 'damage.revive',
      label: 'Put one entity back on its feet',
      run: (context, id) => context.damage.revive(id) ?? { error: `nothing damageable called "${id}"` }
    }
  ]
}

// ----------------------------------------------------------------- the vectors
const asVector = v =>
  v && typeof v.x === 'number' && typeof v.y === 'number' && typeof v.z === 'number'
    ? { x: v.x, y: v.y, z: v.z }
    : null

const minus = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z })
const scaled = (v, by) => ({ x: v.x * by, y: v.y * by, z: v.z * by })
const lengthOf = v => Math.hypot(v.x, v.y, v.z)
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z

const middleOf = entity => ({ x: entity.x, y: entity.y, z: entity.z })

/** Where this entity sees from — the point a flashbang has to be visible to. */
function eyeOf(entity) {
  const box = entity.collider?.box
  const height = Array.isArray(box) && box.length === 3
    ? box[1] * (entity.scale ?? 1)
    : STANDING_HEIGHT
  return { x: entity.x, y: entity.y - height / 2 + height * EYE_FRACTION, z: entity.z }
}

const clamp = (n, low, high) => (n < low ? low : n > high ? high : n)
const round = n => Math.round(n * 1000) / 1000
