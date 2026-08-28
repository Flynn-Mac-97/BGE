/**
 * Bot Brain — an opponent that plays the same game you do.
 *
 * Everything below reaches the world through the fields a human reaches it
 * through: `wishForward`, `wishStrafe`, `wishJump`, `wishCrouch`, `wishWalk`
 * and `wishUse` are the WASD keys, `aimYaw` and `aimPitch` are the mouse, and
 * the trigger is `context.weapons.fire`. Those are the same fields
 * `player-controlled` writes off the keyboard and the camera, read by the same
 * `counter-strike-movement` underneath. There is no private path — the moment a
 * bot can move in a way a player cannot, the human and the bot are playing two
 * different games and no amount of tuning can balance them against each other.
 *
 * The whole thing is a small state machine, on purpose. A behaviour tree would
 * be a second language to learn before anybody could fix a bot that stands in a
 * doorway, and this has to stay the sort of file you can read in one sitting.
 *
 * What makes it feel like a person rather than a turret is four things, and
 * they are the four that are usually left out:
 *
 *   reaction time   the clock starts when you enter its view cone, not when
 *                   you enter the map
 *   a view cone     about ninety degrees, checked with a real ray, and not
 *                   checked every frame for every bot
 *   aim that travels  it turns at a limited speed, overshoots a little, and
 *                   its aim error shrinks the longer it has been tracking you
 *   spray discipline  bursts at range, holds it down up close, and stops
 *                   moving to take a long shot
 *
 * One property scales all of it. `skill` at 0 is a bot that takes half a second
 * to react and cannot hold an angle; at 1 it is quick, accurate and uses cover.
 */

/** Where the eye sits above the feet, standing and crouched. Counter-Strike's own numbers. */
const EYE_STANDING = 1.62
const EYE_CROUCHED = 0.91

/**
 * How often a bot looks around, in seconds, and the phase each one is given at
 * birth. Line of sight is a ray per enemy and there may be ten bots on the map,
 * so they take it in turns rather than all paying for it on the same step.
 */
const SENSE_INTERVAL = 0.1

/** Reaction time, in seconds, from useless to frightening. */
const SLOWEST_REACTION = 0.5
const FASTEST_REACTION = 0.2

/** Aim error in radians the moment a target appears, before tracking settles it. */
const WORST_AIM = 0.09
const BEST_AIM = 0.012

/** How fast the head turns, in radians a second. */
const SLOWEST_TURN = 4
const FASTEST_TURN = 11

/** Overshoot. A head that stops exactly on target every time reads as a machine. */
const TURN_GAIN = 1.15

/** Closer than this a bot holds the trigger down; further away it fires in bursts. */
const CLOSE_RANGE = 8

/** Past this, standing still to shoot is worth more than closing the distance. */
const STAND_STILL_RANGE = 12

/** How far gunfire and running footsteps carry. Counter-Strike is played by ear. */
const GUNFIRE_HEARD = 45
const FOOTSTEPS_HEARD = 18

/** Below this fraction of full health a bot that is good enough will break contact. */
const HURT = 0.35

const RADIANS = Math.PI / 180

/** Said once each, because a bot that reports a missing plugin sixty times a second buries the log. */
const alreadySaid = new Set()
function report(key, message) {
  if (alreadySaid.has(key)) return
  alreadySaid.add(key)
  console.error(`[bot-brain] ${message}`)
}

export default {
  about: 'play the map like a person: look, react, aim, shoot, and walk to the objective',

  properties: {
    /** 0 is a warm body, 1 is somebody you would rather not meet. One number, everything scales off it. */
    skill: 0.5,
    /** Degrees, total. A bot must not see what is behind it. */
    viewCone: 90,
    /** Metres. Past this it does not look, whatever the fog says. */
    sightRange: 60,
    /**
     * Which bomb site this one has in mind, "A" or "B". Left empty it rolls
     * one at birth and keeps it, so a bot does not change its plan halfway
     * down a corridor; set on a placement it is how you build a team that
     * rushes B.
     */
    site: null
  },

  /**
   * Everything a bot needs before its first thought.
   *
   * Reachable from `update` as well as from here, because `start` only runs on
   * the entities that were in the world when play began — a bot spawned into a
   * round already under way, which is what every respawn is, would otherwise
   * think with an undefined aim and turn into NaN on its first step.
   */
  start(entity, context, self) { wake(entity, context, self) },

  update(entity, seconds, context, self) {
    if (self.aimYaw === undefined) wake(entity, context, self)
    const carry = entity.carriesWeapons || entity['carries-weapons'] || null
    const life = entity.damageable || null

    // Nothing to decide while dead, and nothing to decide before the round
    // starts either — walking during the freeze is a bug you can see from
    // across the map.
    idle(entity)
    if (life && life.alive === false) {
      // Said rather than left holding the last thought it had, so a corpse in
      // `navigation.bots` reads as a corpse instead of as a bot in cover.
      self.state = 'dead'
      self.wasDead = true
    } else if (entity.properties?.team) {
      // A respawn is a new life and not a continuation of the last one. Without
      // this the bot walks out of its spawn following the route it was on when
      // it was shot, which starts on the other side of the map and reads as a
      // bot marching confidently into a wall.
      if (self.wasDead) { wake(entity, context, self); self.wasDead = false }

      if (context.match?.phase === 'freeze' || context.match?.phase === 'warmup') {
        self.state = 'buy'
        buy(entity, context, self)
      } else {
        if (context.time >= self.senseAt) {
          self.senseAt = context.time + SENSE_INTERVAL
          sense(entity, context, self)
        }
        self.state = decide(entity, context, self, carry, life)
        act(entity, seconds, context, self, carry)
      }
    }

    // The mouse, written once a step whatever decided it. `aimYaw` and
    // `aimPitch` are the fields `counter-strike-movement`, `weapons` and the
    // radar all read, and they are exactly what `player-controlled` writes off
    // the camera — there is one aim on an entity, however it got there.
    // `rotation` is the same angle in the degrees the renderer turns a mesh by,
    // without which a bot's model faces one way for the whole match.
    entity.aimYaw = self.aimYaw
    entity.aimPitch = self.aimPitch
    entity.rotation = self.aimYaw / RADIANS
  }
}

function wake(entity, context, self) {
  self.aimYaw = (entity.rotation ?? 0) * RADIANS
  self.aimPitch = 0
  self.state = 'buy'
  self.target = null
  self.firesAt = 0
  self.trackingSince = 0
  self.errorYaw = 0
  self.errorPitch = 0
  self.burst = 0
  self.triggerPulls = 0
  self.holdFireUntil = 0
  self.path = null
  self.step = 0
  self.goal = null
  self.stuck = 0
  self.wasX = entity.x
  self.wasZ = entity.z
  self.checkStuckAt = context.time + 0.6
  self.jumpUntil = 0
  self.sidestepUntil = 0
  self.sidestepping = false
  self.sidestepWay = 1
  self.noise = null
  self.coverUntil = 0
  self.wasDead = false
  self.boughtInRound = -1
  // Each bot looks around on its own phase, so ten of them never spend their
  // rays on the same step.
  self.senseAt = context.time + context.random.range(0, SENSE_INTERVAL)
  if (self.site !== 'A' && self.site !== 'B') self.site = context.random.pick(['A', 'B'])

  if (!entity.properties?.team) {
    report(`team-${entity.type}`, `${entity.id} has no properties.team, so it cannot tell friend from enemy — it will stand still`)
  }
}

// ------------------------------------------------------------------- the senses
/**
 * One pass over the map: what this bot can see, and what it can hear.
 *
 * Both at once because they ask the same question of the same list, and this
 * runs ten times a second for every bot on the map. Sight is the expensive
 * half — a ray each — so a candidate further away than the best one already
 * found never costs one.
 *
 * A target has to be inside the view cone *and* on the end of a clear ray
 * before its reaction clock starts. Triggers are stepped over on the way: a
 * bomb site is a collider a bullet ignores, and a bot that could not see
 * through one would be blind while standing on the objective.
 */
function sense(entity, context, self) {
  if (!context.raycast) { report('raycast', 'context.raycast is missing, so no bot can see anything — is Physics 3D loaded?'); return }

  const eye = eyeOf(entity)
  const cone = Math.cos((self.viewCone / 2) * RADIANS)
  const facing = forwardOf(self.aimYaw, self.aimPitch)
  let best = null, bestDistance = Infinity

  for (const other of context.world.entities) {
    if (other === entity) continue
    const team = other.properties?.team
    if (!team || team === entity.properties.team) continue
    if (other.damageable?.alive === false) continue

    const dx = other.x - eye.x, dy = other.y - eye.y, dz = other.z - eye.z
    const distance = Math.hypot(dx, dy, dz)
    if (distance < 0.01) continue

    // Ears first, because sound goes through the wall that sight stops at.
    if (distance <= loudness(other, context)) {
      self.noise = { x: other.x, y: other.y, z: other.z, at: context.time }
    }

    if (distance > self.sightRange || distance >= bestDistance) continue
    if ((dx * facing.x + dy * facing.y + dz * facing.z) / distance < cone) continue

    const hit = context.raycast(eye, { x: dx / distance, y: dy / distance, z: dz / distance }, distance + 1, {
      ignore: [entity],
      hit: candidate => candidate.properties?.body !== 'trigger'
    })
    if (hit && hit.entity === other) { best = other; bestDistance = distance }
  }

  if (best && best !== self.target) {
    // A new face: start the reaction clock and roll the aim error this bot will
    // spend the next second correcting.
    const skill = clamp(self.skill, 0, 1)
    self.target = best
    self.trackingSince = context.time
    self.firesAt = context.time + mix(SLOWEST_REACTION, FASTEST_REACTION, skill) * context.random.range(0.8, 1.3)
    const spread = mix(WORST_AIM, BEST_AIM, skill)
    self.errorYaw = context.random.range(-spread, spread)
    self.errorPitch = context.random.range(-spread, spread) * 0.6
  } else if (!best) {
    // Remember where it went, so losing sight turns into a hunt rather than a shrug.
    if (self.target) self.noise = { x: self.target.x, y: self.target.y, z: self.target.z, at: context.time }
    self.target = null
  }
}

/**
 * How far away this body can be heard, in metres.
 *
 * Read off plain fields rather than off the audio plugin, because a sound is
 * recorded without a position and a bot needs to know *where*. An enemy that
 * has fired inside the last moment is loud a long way off; one that is running
 * is loud nearby; one that is walking is not loud at all, which is the whole
 * reason the walk key exists.
 */
function loudness(other, context) {
  const carry = other.carriesWeapons || other['carries-weapons']
  if (carry && carry.nextShotAt > context.time) return GUNFIRE_HEARD
  return Math.hypot(other.velocityX ?? 0, other.velocityZ ?? 0) > 3.5 ? FOOTSTEPS_HEARD : 0
}

// -------------------------------------------------------------------- the plan
/** One state, chosen fresh each step, so nothing can get stuck in a state that no longer makes sense. */
function decide(entity, context, self, carry, life) {
  if (carry && carry.reloadingUntil > context.time) return 'reload'
  if (carry && carry.ammo === 0 && carry.reserve > 0) return 'reload'

  if (self.target) {
    // Only a bot with some skill knows to leave. A bad one stands and trades,
    // which is exactly what a bad player does.
    const hurt = life && life.health <= (life.maxHealth ?? 100) * HURT
    if (!hurt || self.skill <= 0.4) return 'engage'
    if (context.time >= self.coverUntil) self.coverUntil = context.time + context.random.range(1.5, 3)
    return 'cover'
  }

  // A quarter of a magazine left and nobody in sight is the moment a player
  // reloads. The size comes off the weapon table rather than a guess, because
  // a quarter of a Deagle is one shot and a quarter of a P90 is twelve.
  const magazine = context.weapons?.get?.(carry?.current)?.magazine
  if (carry && carry.reserve > 0 && magazine && carry.ammo <= Math.max(1, Math.floor(magazine * 0.25))) return 'reload'

  const planted = context.match?.state?.bombPlantedAt > 0
  const mine = entity.properties.team === 'terrorist'
  if (!planted && mine && carry?.bomb && inside(entity, siteOf(context, self.site))) return 'plant'
  if (planted && !mine && near(entity, bombPoint(context), 1.6)) return 'defuse'

  if (self.noise && context.time - self.noise.at < 8) return 'hunt'
  return 'advance'
}

/** Do the one thing this state does. Every state ends up writing the same wish fields. */
function act(entity, seconds, context, self, carry) {
  const skill = clamp(self.skill, 0, 1)

  switch (self.state) {
    case 'engage': {
      const target = self.target
      const distance = Math.hypot(target.x - entity.x, target.y - entity.y, target.z - entity.z)
      track(entity, seconds, context, self, target, skill)
      // Stop to shoot at range. Counter-Strike punishes moving fire harder than
      // any other shooter, and a bot that sprays while running is free kills.
      if (distance > STAND_STILL_RANGE) stop(entity)
      else strafe(entity, context, self, skill)
      shoot(entity, context, self, carry, distance, skill)
      break
    }

    case 'cover': {
      // Back away from what is shooting at it, and keep looking at it on the way.
      const target = self.target
      track(entity, seconds, context, self, target, skill)
      const away = {
        x: entity.x + (entity.x - target.x), y: entity.y, z: entity.z + (entity.z - target.z)
      }
      walkTo(entity, context, self, context.navigation?.nearest(away) || away)
      entity.wishCrouch = false
      break
    }

    case 'reload':
      context.weapons?.reload?.(entity)
      walkTo(entity, context, self, objective(entity, context, self))
      turnTowardsTravel(entity, seconds, self)
      break

    case 'plant':
      stop(entity)
      entity.wishCrouch = true
      // Exactly the human gesture: put the bomb in your hands, hold the button.
      if (carry && carry.current !== carry.bomb) context.weapons?.select?.(entity, 'bomb')
      entity.wishUse = true
      entity.useHeld = true
      if (carry && carry.current === carry.bomb) context.weapons?.fire?.(entity)
      break

    case 'defuse':
      stop(entity)
      entity.wishCrouch = true
      entity.wishUse = true
      entity.useHeld = true
      break

    case 'hunt':
      walkTo(entity, context, self, self.noise)
      turnTowardsTravel(entity, seconds, self)
      // Close to whatever made the noise, walk rather than run: the last few
      // metres are the ones where being heard first decides the duel.
      entity.wishWalk = near(entity, self.noise, 8)
      if (near(entity, self.noise, 2)) self.noise = null
      break

    default:
      walkTo(entity, context, self, objective(entity, context, self))
      turnTowardsTravel(entity, seconds, self)
  }
}

// -------------------------------------------------------------------- the hands
/**
 * Turn the head towards a target, at a limited speed and never straight to it.
 *
 * The gain above one is what makes it human: the head arrives slightly past
 * where it was going and comes back, which is what a hand on a mouse does. The
 * aim error decays with the time spent tracking, so a target that has been in
 * view for a second is held properly and one that has just appeared is not.
 */
function track(entity, seconds, context, self, target, skill) {
  const eye = eyeOf(entity)
  // A better bot aims higher up the body. This is the whole of "bots go for
  // the head", and it belongs on the skill dial with everything else.
  const aimHeight = target.y + mix(0, 0.45, skill)
  const wanted = anglesTo(eye, { x: target.x, y: aimHeight, z: target.z })

  const settled = Math.exp(-(context.time - self.trackingSince) / 0.6)
  aimAt(entity, self,
    wanted.yaw + self.errorYaw * settled,
    wanted.pitch + self.errorPitch * settled,
    seconds, mix(SLOWEST_TURN, FASTEST_TURN, skill))
}

/** Move the aim towards where it wants to be, and no faster than a hand could. */
function aimAt(entity, self, wantYaw, wantPitch, seconds, turnRate = SLOWEST_TURN) {
  const limit = turnRate * seconds
  self.aimYaw = wrap(self.aimYaw + clamp(wrap(wantYaw - self.aimYaw) * TURN_GAIN, -limit, limit))
  self.aimPitch = clamp(
    self.aimPitch + clamp((wantPitch - self.aimPitch) * TURN_GAIN, -limit, limit),
    -Math.PI / 2 + 0.01, Math.PI / 2 - 0.01
  )
}

/**
 * Look where you are going. A bot walking sideways down a corridor looks
 * broken, and a bot facing its next waypoint is also a bot whose forward key
 * is the one doing the work.
 */
function turnTowardsTravel(entity, seconds, self) {
  aimAt(entity, self, self.travelYaw ?? self.aimYaw, 0, seconds, SLOWEST_TURN)
}

/**
 * Pull the trigger, or do not.
 *
 * Three gates, and all three are what stops this being an aimbot: the reaction
 * clock has to have run out, the aim has to actually be on the target rather
 * than merely pointing its way, and a burst has to have finished resting.
 */
function shoot(entity, context, self, carry, distance, skill) {
  if (context.time < self.firesAt) return
  if (context.time < self.holdFireUntil) return
  if (carry && carry.ammo === 0) return

  const eye = eyeOf(entity)
  const wanted = anglesTo(eye, { x: self.target.x, y: self.target.y, z: self.target.z })
  // Half the width of a player at this range: pointing anywhere inside that
  // and the shot is on the body.
  const acceptable = Math.atan2(0.45, Math.max(distance, 1)) + 0.01
  if (Math.abs(wrap(wanted.yaw - self.aimYaw)) > acceptable) return
  if (Math.abs(wanted.pitch - self.aimPitch) > acceptable) return

  // Counted in the bag before the call, so "did this bot decide to shoot" is a
  // plain field anyone can read — including a test, which is handed no context
  // and so could never see the weapon plugin's side of it.
  self.triggerPulls = (self.triggerPulls ?? 0) + 1
  if (!context.weapons?.fire) { report('weapons', 'context.weapons.fire is missing, so bots can aim at you but never shoot'); return }
  context.weapons.fire(entity)

  // Up close the trigger stays down; at range the burst is short and the pause
  // between bursts is what a bot with skill uses to let the recoil settle.
  if (distance <= CLOSE_RANGE) return
  self.burst++
  if (self.burst >= Math.round(mix(5, 2, skill))) {
    self.burst = 0
    self.holdFireUntil = context.time + mix(0.15, 0.35, skill)
  }
}

// -------------------------------------------------------------------- the feet
/**
 * Wishing for nothing. Every step starts here so no intent survives the step
 * that had it.
 *
 * `useHeld` is written beside `wishUse` for the same reason `player-controlled`
 * writes both: the match rules read one name and the wish fields use the other,
 * and until those two lanes agree a bot that wrote only half of them could
 * never plant or defuse.
 */
function idle(entity) {
  entity.wishForward = 0
  entity.wishStrafe = 0
  entity.wishJump = false
  entity.wishCrouch = false
  entity.wishWalk = false
  entity.wishUse = false
  entity.useHeld = false
}

const stop = entity => { entity.wishForward = 0; entity.wishStrafe = 0 }

/** Sidestep while shooting up close, the way a player does, and never while lining up a long shot. */
function strafe(entity, context, self, skill) {
  if (skill < 0.3) return stop(entity)
  if (self.strafeUntil === undefined || context.time > self.strafeUntil) {
    self.strafeUntil = context.time + context.random.range(0.4, 1.1)
    self.strafeWay = context.random.chance(0.5) ? 1 : -1
  }
  entity.wishForward = 0
  entity.wishStrafe = self.strafeWay
}

/**
 * Walk to a place, along a path the navigation found, and notice when that is
 * not working.
 *
 * The stuck check is the important half. Everything else here is arithmetic;
 * this is the part that stops the failure everybody ships, which is a bot
 * pressing forward into a doorframe until the round ends. Two checks in a row
 * with nothing to show for them and it throws the path away — and after the
 * second it jumps, because a lip a step too tall is what a person jumps at.
 */
function walkTo(entity, context, self, goal) {
  if (!goal) return stop(entity)
  // Already there. Said before anything else so that a bot standing on its
  // objective stops rather than shuffling towards the middle of the cell it is
  // in, and so that it keeps facing wherever it was facing when it arrived.
  if (Math.hypot(goal.x - entity.x, goal.z - entity.z) < 1) return stop(entity)

  if (context.time >= self.checkStuckAt) {
    const moved = Math.hypot(entity.x - self.wasX, entity.z - self.wasZ)
    if (moved < 0.25) { self.stuck++; self.path = null } else self.stuck = 0
    self.wasX = entity.x
    self.wasZ = entity.z
    self.checkStuckAt = context.time + 0.6
    if (self.stuck >= 2) {
      // A tap, not a held key. Holding jump is the trap here: a body in the air
      // accelerates at a fraction of a walking pace, so a bot that answers being
      // stuck by bunny-hopping into the wall it is stuck on can never build the
      // speed to get off it, and the count climbs for the rest of the round.
      self.jumpUntil = context.time + 0.1
      // And a shove sideways, because most of what a body catches on in this map
      // is a corner it is pressed straight into.
      self.sidestepUntil = context.time + 0.45
      self.sidestepWay = context.random.chance(0.5) ? 1 : -1
    }
  }
  entity.wishJump = context.time < (self.jumpUntil ?? 0)
  self.sidestepping = context.time < (self.sidestepUntil ?? 0)

  const moved = !self.goal || Math.hypot(self.goal.x - goal.x, self.goal.z - goal.z) > 2
  if (!self.path || moved || self.step >= self.path.length) {
    self.goal = { x: goal.x, y: goal.y, z: goal.z }
    self.path = context.navigation?.path(entity, goal) || null
    self.step = 0
    if (!context.navigation) {
      report('navigation', 'context.navigation is missing, so bots walk in straight lines at walls — is Bot Navigation loaded?')
    }
  }

  // No route, or none needed: head straight at it. Physics will stop the bot at
  // whatever is in the way and the stuck check will ask for a new path.
  let waypoint = goal
  if (self.path && self.path.length) {
    while (self.step < self.path.length - 1 &&
           Math.hypot(self.path[self.step].x - entity.x, self.path[self.step].z - entity.z) < 0.7) {
      self.step++
    }
    waypoint = self.path[self.step]
  }
  steer(entity, self, waypoint)
}

/** Turn a direction in the world into the two keys a player would be holding. */
function steer(entity, self, waypoint) {
  const dx = waypoint.x - entity.x, dz = waypoint.z - entity.z
  const length = Math.hypot(dx, dz)
  if (length < 0.05) return stop(entity)
  self.travelYaw = Math.atan2(-dx, -dz)

  const yaw = self.aimYaw
  const forwardX = -Math.sin(yaw), forwardZ = -Math.cos(yaw)
  const rightX = Math.cos(yaw), rightZ = -Math.sin(yaw)
  entity.wishForward = clamp(((dx / length) * forwardX + (dz / length) * forwardZ) * 1.6, -1, 1)
  entity.wishStrafe = clamp(((dx / length) * rightX + (dz / length) * rightZ) * 1.6, -1, 1)

  // Coming off something it caught on: keep going, but go past the corner
  // rather than through it.
  if (self.sidestepping) entity.wishStrafe = self.sidestepWay
}

// ---------------------------------------------------------------- the objective
/** Where this bot is trying to be when nobody is shooting at it. */
function objective(entity, context, self) {
  const planted = context.match?.state?.bombPlantedAt > 0
  if (planted) return bombPoint(context) || siteOf(context, context.match?.state?.bombSite || self.site)

  let site = siteOf(context, self.site)
  // Arrived, and nobody came. Standing on an empty site until the clock runs
  // out is how a round ends with two teams waiting for each other in different
  // corners, so a bot with no bomb to plant goes and looks at the other site
  // instead. Changing the plan rather than the destination is the point: the
  // decision is recorded, so it cannot flip back the moment it walks away.
  const carrying = (entity.carriesWeapons || entity['carries-weapons'])?.bomb
  if (site && !carrying && near(entity, site, 8)) {
    self.site = self.site === 'A' ? 'B' : 'A'
    site = siteOf(context, self.site)
  }
  if (site) return site
  // No bomb sites in this level: walk at the other team's spawn instead, which
  // is the only other place anybody is reliably going to be.
  const enemySpawn = context.world.entities.find(other =>
    other.type === 'spawn-point' && other.properties?.team && other.properties.team !== entity.properties.team)
  return enemySpawn ? { x: enemySpawn.x, y: enemySpawn.y, z: enemySpawn.z } : null
}

/** The floor of a bomb site, not its middle — the middle of that box is over your head. */
function siteOf(context, name) {
  if (!name) return null
  const found = context.world.entities.find(other =>
    other.properties?.site === name && Array.isArray(other.collider?.box))
  if (!found) return null
  return { x: found.x, y: found.y - (found.collider.box[1] * (found.scale ?? 1)) / 2, z: found.z }
}

function bombPoint(context) {
  const bomb = context.world.entities.find(other => other.type === 'bomb' || other.properties?.bomb === 'planted')
  return bomb ? { x: bomb.x, y: bomb.y, z: bomb.z } : null
}

/**
 * Ask for a gun once, if this run has weapons in it at all.
 *
 * The money is the match's business, not the brain's — a bot that paid itself
 * would be a second economy running beside the real one.
 */
function buy(entity, context, self) {
  // Once a round, not once a lifetime: every round begins with the same
  // decision, and a bot that only ever bought on the first one would spend the
  // rest of the match holding a pistol.
  const round = context.match?.state?.round ?? 0
  if (self.boughtInRound === round) return
  self.boughtInRound = round
  const carry = entity.carriesWeapons || entity['carries-weapons']
  if (carry?.primary) return
  if (!context.weapons?.give) { report('give', 'context.weapons.give is missing, so bots start a round with whatever they are holding'); return }
  const wanted = entity.properties.team === 'terrorist' ? 'ak47' : 'm4a1'
  if (context.weapons.get?.(wanted)) context.weapons.give(entity, wanted)
}

// ------------------------------------------------------------------ small print
const clamp = (value, low, high) => Math.max(low, Math.min(high, value))
const mix = (low, high, amount) => low + (high - low) * clamp(amount, 0, 1)
const wrap = angle => Math.atan2(Math.sin(angle), Math.cos(angle))

const near = (entity, place, distance) =>
  !!place && Math.hypot(entity.x - place.x, entity.z - place.z) <= distance

/** Standing in a place, rather than merely close to it. */
const inside = (entity, place) => near(entity, place, 6)

/** Where this body's eye is: its feet, plus the height it is standing at. */
function eyeOf(entity) {
  const box = entity.collider?.box
  const halfHeight = Array.isArray(box) ? (box[1] * (entity.scale ?? 1)) / 2 : 0.915
  // `crouched` is the plain field the movement model publishes; the height is
  // the fallback for a body nobody is moving.
  const crouched = entity.crouched === true || halfHeight < 0.7
  return { x: entity.x, y: entity.y - halfHeight + (crouched ? EYE_CROUCHED : EYE_STANDING), z: entity.z }
}

/** Yaw about +Y, pitch up — the same convention `context.camera.forward()` uses. */
function forwardOf(yaw, pitch) {
  const flat = Math.cos(pitch)
  return { x: -Math.sin(yaw) * flat, y: Math.sin(pitch), z: -Math.cos(yaw) * flat }
}

/** Its inverse: the angles that would point from one place at another. */
function anglesTo(from, to) {
  const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z
  const flat = Math.hypot(dx, dz)
  return { yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, flat || 1e-6) }
}
