/**
 * Match Rules — the round, the bomb, and the money.
 *
 * This is the part of Counter-Strike that makes it a sport rather than a
 * shooting gallery. Every number below exists because it creates a decision:
 * six seconds of freeze time is long enough to see your team and short enough
 * that nobody wanders off, fifteen seconds of buy time is why a force-buy is a
 * gamble rather than a shrug, and the loss bonus ladder is the entire reason a
 * team ever chooses to save. They are the real numbers, converted from nothing
 * and simplified nowhere.
 *
 * ## What it puts on context
 *
 *     context.match.state        the round, live and readable
 *     context.match.phase        warmup | freeze | live | roundEnd | matchEnd
 *     context.match.money(entity)
 *     context.match.pay(entity, amount, reason)
 *     context.match.killed(victim, killer, weapon, headshot)
 *     context.match.hold(entity)    one step of holding `use` — plant or defuse
 *
 * ## What it puts on an entity, for other lanes to read
 *
 * These are plain fields, which is how two pieces of game code are allowed to
 * agree in this engine. Nothing here looks anything else up.
 *
 *     entity.frozen        true during freeze time — movement code must obey it,
 *                          and this plugin pins the body as well, so a lane that
 *                          has not read this yet still cannot run out of spawn
 *     entity.money         what this player can spend, 0..16000
 *     entity.hasBomb       this terrorist is carrying the C4
 *     entity.hasDefuseKit  halves the defuse — the buy menu sets this
 *
 * and it reads one that already existed: `entity.wishUse`, the field
 * `player-controlled` writes from the keyboard and `bot-brain` writes for
 * itself. Planting and defusing therefore have exactly one door, and a bot goes
 * through the same one a human does. A bot with a private path is a bot playing
 * a different game, and neither game can then be balanced against the other.
 *
 * ## What it writes into world.state
 *
 * phase, round, roundTime, freezeTime, buyTime, scoreTerrorist,
 * scoreCounterTerrorist, aliveTerrorist, aliveCounterTerrorist, money,
 * bombPlanted, bombTime — flat, so the HUD reads them with {name} and an agent
 * reads them with `engine.mjs run hud.read`. `world.state.match` is the same
 * object as `context.match.state`: one object under two names, so a test and an
 * agent can read the round's own clock without a second copy of it existing.
 *
 * Written every fixed step rather than once, deliberately. A type's `start`
 * hook is free to assign `context.world.state = {...}` wholesale — the demo
 * player does exactly that — and a match that reported itself once would
 * vanish the first time a level did.
 */

// ---------------------------------------------------------------- the clock
// Seconds. Counter-Strike 1.6's own numbers.
const FREEZE_SECONDS = 6
const BUY_SECONDS = 15            // from round start, so it outlasts the freeze by nine
const ROUND_SECONDS = 115         // 1:55
const BOMB_SECONDS = 35
const PLANT_SECONDS = 3
const DEFUSE_SECONDS = 10
const DEFUSE_KIT_SECONDS = 5      // which is the whole reason the kit is worth buying
const ROUND_END_SECONDS = 10
const ROUNDS_TO_WIN = 16
const SWAP_AFTER_ROUND = 15

// ---------------------------------------------------------------- the money
const MONEY_START = 800
const MONEY_MAXIMUM = 16000
const MONEY_ROUND_WIN = 3250
// Escalates while a team keeps losing and resets the moment it wins one. This
// ladder is why round four matters: a team three rounds down is richer than a
// team one round down, and both of them know it.
const MONEY_LOSS_BONUS = [1400, 1900, 2400, 2900, 3400]
const MONEY_PLANT = 800
const MONEY_DEFUSE = 300

/**
 * What a kill pays, by weapon.
 *
 * The knife paying 1500 is a joke the game plays on you and it is load-bearing:
 * it is the only reason anyone ever takes a knife to a rifle fight. The AWP
 * paying 100 is the counterweight, and it is the only economic brake on the
 * best gun in the game. The rest of the ladder is the real 1.6 table.
 */
const KILL_REWARD_DEFAULT = 300
const KILL_REWARD = {
  knife: 1500,
  awp: 100,
  m3: 900, xm1014: 900,
  mp5: 600, mp5navy: 600, tmp: 600, mac10: 600, ump45: 600, scout: 600
}

// ---------------------------------------------------------------- the sides
const TERRORIST = 'terrorist'
const COUNTER_TERRORIST = 'counter-terrorist'
const SCORE_KEY = { [TERRORIST]: 'scoreTerrorist', [COUNTER_TERRORIST]: 'scoreCounterTerrorist' }
const STREAK_KEY = { [TERRORIST]: 'lossStreakTerrorist', [COUNTER_TERRORIST]: 'lossStreakCounterTerrorist' }
const otherTeam = team => (team === TERRORIST ? COUNTER_TERRORIST : TERRORIST)

// ---------------------------------------------------------------- the reach
// How far a planter may drift before the plant is abandoned. Generous enough
// that settling onto the floor is not "moving" and tight enough that walking is.
const PLANT_DRIFT = 0.2
// About 62 Half-Life units, which is what "standing next to it" means in 1.6.
const DEFUSE_REACH = 1.6
const PICKUP_REACH = 1.2
const BLAST_RADIUS = 10
const BLAST_DAMAGE = 500
/**
 * How stale a "I am holding use" stamp may be and still count.
 *
 * `wishUse` is written from an update hook, which runs *after* the systems in
 * the same fixed step, so the answer always arrives one step late. One step of
 * slack costs nothing and means the field and `context.match.hold()` behave
 * identically — which is the whole point of there being one path.
 */
const HOLD_GRACE = 1.5 / 60

const SOUND = {
  roundStart: 'assets/counter-strike/sounds/round-start.wav',
  plantStart: 'assets/counter-strike/sounds/c4-plantstart.wav',
  pickup: 'assets/counter-strike/sounds/pickup-weapon.wav'
}

// ------------------------------------------------------------------ the state
function freshState() {
  return {
    phase: 'warmup',
    round: 0,
    scoreTerrorist: 0,
    scoreCounterTerrorist: 0,
    freezeEndsAt: 0,
    buyEndsAt: 0,
    roundEndsAt: 0,
    nextRoundAt: 0,
    bombPlantedAt: 0,
    bombExplodesAt: 0,
    bombSite: null,
    bombCarrier: null,
    bombDropped: null,
    plantProgress: 0,
    defuseProgress: 0,
    lossStreakTerrorist: 0,
    lossStreakCounterTerrorist: 0,
    winner: null,
    reason: null,
    sidesSwapped: false
  }
}

// ------------------------------------------------------------------ who plays
/**
 * A combatant is anything that can be shot or can shoot: it has a `damageable`
 * bag, or a `carriesWeapons` one.
 *
 * Recognised by what it carries rather than by its type name, so a bot, a human
 * and whatever the next lane invents all count without this file being edited.
 * Deliberately NOT "anything called player": something with no damageable bag
 * can never die, and one unkillable body on a side would make that side
 * impossible to eliminate — a round that can never end, for a reason nothing on
 * screen could explain. `spawn-point` declares a team and has neither bag, which
 * is why a marker cannot end a round by standing there.
 */
const isCombatant = entity => !!entity && (entity.damageable != null || carryBag(entity) != null)

/**
 * The carrier's inventory, under either of its two names.
 *
 * A behaviour's bag is `entity[<file name>]`, so the file `carries-weapons.js`
 * puts it at `entity['carries-weapons']`; the weapons lane also points
 * `entity.carriesWeapons` at the same object, but not until it has had a reason
 * to. Reading both is one line here and saves a bomb that exists under a name
 * this file was not looking at.
 */
const carryBag = entity => entity.carriesWeapons ?? entity['carries-weapons'] ?? null

/** Is this one carrying the C4? Its own field, or the inventory that holds it. */
const carriesBomb = entity => entity.hasBomb === true || !!carryBag(entity)?.bomb

const combatants = context => context.world.entities.filter(isCombatant)

const teamOf = entity => {
  const team = entity.properties?.team ?? entity.damageable?.team
  return team === TERRORIST || team === COUNTER_TERRORIST ? team : null
}

// No damage lane yet means nobody has died yet, which is the honest answer.
const isAlive = entity => (entity.damageable ? entity.damageable.alive !== false : true)

const aliveCount = (context, team) =>
  combatants(context).filter(entity => teamOf(entity) === team && isAlive(entity)).length

/** The plugin's own scratch for one player's round. Never state the entity owns. */
function record(context, entity) {
  let bag = context.match.records.get(entity.id)
  if (!bag) {
    bag = {
      anchor: null, usedAt: -1e9, plantSoundAt: -1e9,
      plantProgress: 0, defuseProgress: 0, plantAnchor: null, deathCounted: false
    }
    context.match.records.set(entity.id, bag)
  }
  return bag
}

// ------------------------------------------------------------------ the money
const wallet = entity => (typeof entity.money === 'number' ? entity.money : MONEY_START)

function pay(context, entity, amount, reason) {
  if (!entity) return 0
  const before = wallet(entity)
  const after = before + amount
  if (after < 0) {
    console.error(`[match-rules] ${entity.id} cannot afford ${-amount} — it has ${before} (${reason})`)
    entity.money = before
    return before
  }
  entity.money = Math.min(after, MONEY_MAXIMUM)
  return entity.money
}

function killReward(context, weapon) {
  const id = typeof weapon === 'string' ? weapon : weapon?.id
  if (!id) return KILL_REWARD_DEFAULT
  // The weapon table gets the last word if it has an opinion, so a new gun is
  // priced where it is declared rather than in two files that can disagree.
  const declared = context.weapons?.get?.(id)?.killReward
  if (typeof declared === 'number') return declared
  return KILL_REWARD[String(id).toLowerCase()] ?? KILL_REWARD_DEFAULT
}

// ------------------------------------------------------------------ the round
function canStart(context) {
  // A match needs a map that declares sides. Without this, every level with two
  // player entities in it would quietly start playing Counter-Strike.
  const hasMap = context.world.all('spawn-point').length > 0 || context.world.all('bomb-site').length > 0
  if (!hasMap) return false

  const playing = combatants(context)
  if (playing.length < 2) return false
  const declared = new Set(playing.map(teamOf).filter(Boolean))
  const undeclared = playing.filter(entity => !teamOf(entity)).length
  // Anyone who has not picked a side is put on the smaller one below, so two
  // undeclared players are two sides; two declared terrorists are not.
  return declared.size === 2 || (declared.size === 1 && undeclared > 0) || declared.size === 0
}

function assignTeam(context, entity) {
  const already = teamOf(entity)
  if (already) return already
  const terrorists = combatants(context).filter(other => teamOf(other) === TERRORIST).length
  const counterTerrorists = combatants(context).filter(other => teamOf(other) === COUNTER_TERRORIST).length
  const team = terrorists <= counterTerrorists ? TERRORIST : COUNTER_TERRORIST
  entity.properties = entity.properties || {}
  entity.properties.team = team
  if (entity.damageable) entity.damageable.team = team
  return team
}

function beginMatch(context) {
  const state = context.match.state
  Object.assign(state, freshState())
  context.match.records.clear()
  for (const entity of combatants(context)) {
    assignTeam(context, entity)
    entity.money = MONEY_START
  }
  beginRound(context, 1)
}

/** Where a body's feet are, so a spawn marker and a player of any height agree. */
const footOf = entity => entity.y - ((entity.collider?.box?.[1] ?? 1.83) * (entity.scale ?? 1)) / 2

function placeAtSpawn(entity, spawn) {
  // A spawn marker is drawn as a standing player, so its own mesh says where
  // the floor under it is. Reading that rather than assuming keeps a short
  // player and a tall one both standing on the ground rather than in it.
  const ground = spawn.y - ((spawn.mesh?.box?.[1] ?? 1.8) * (spawn.scale ?? 1)) / 2
  entity.x = spawn.x
  entity.z = spawn.z
  entity.y = ground + ((entity.collider?.box?.[1] ?? 1.83) * (entity.scale ?? 1)) / 2
  entity.rotation = spawn.rotation ?? entity.rotation
}

/**
 * Put one player back on their feet for a new round.
 *
 * Through `context.damage.revive`, because death is more than a flag: the damage
 * lane flattens the corpse's collider and turns the body into a trigger so it
 * stops blocking doorways, and only that lane knows how to give those back.
 * Armour is handed back explicitly rather than defaulted away — kevlar survives
 * the round that bought it in 1.6, and that is half the reason the first buy
 * round is a real decision.
 */
function revive(context, entity) {
  const bag = entity.damageable
  if (!bag) return
  if (context.damage?.revive) {
    context.damage.revive(entity, { armour: bag.armour ?? 0, helmet: bag.helmet === true })
    return
  }
  bag.health = bag.maxHealth ?? 100
  bag.alive = true
  bag.lastHurtBy = null
}

function clearBomb(context) {
  const state = context.match.state
  for (const bomb of context.world.all('bomb')) context.destroy(bomb)
  state.bombPlantedAt = 0
  state.bombExplodesAt = 0
  state.bombSite = null
  state.bombDropped = null
  state.plantProgress = 0
  state.defuseProgress = 0
}

/**
 * One terrorist carries the C4 — the first one still standing.
 *
 * Deliberately not a random pick. Nine agents are testing against this at once
 * and "who has the bomb" being answerable without running the round is worth
 * more than the variety a shuffle would buy.
 */
function giveBomb(context) {
  const state = context.match.state
  const carrier = combatants(context).find(entity => teamOf(entity) === TERRORIST && isAlive(entity))
  state.bombCarrier = carrier ? carrier.id : null
  if (!carrier) return
  carrier.hasBomb = true
  context.weapons?.give?.(carrier, 'c4')
}

function beginRound(context, roundNumber) {
  const state = context.match.state

  // Sides swap at fifteen, which is the moment a match stops being about the
  // map and starts being about the scoreline.
  if (roundNumber > SWAP_AFTER_ROUND && !state.sidesSwapped) swapSides(context)

  state.round = roundNumber
  state.phase = 'freeze'
  state.freezeEndsAt = context.time + FREEZE_SECONDS
  state.buyEndsAt = context.time + BUY_SECONDS
  state.roundEndsAt = state.freezeEndsAt + ROUND_SECONDS
  state.nextRoundAt = 0
  state.winner = null
  state.reason = null
  clearBomb(context)

  const spawns = {
    [TERRORIST]: context.world.all('spawn-point').filter(spawn => spawn.properties?.team === TERRORIST),
    [COUNTER_TERRORIST]: context.world.all('spawn-point').filter(spawn => spawn.properties?.team === COUNTER_TERRORIST)
  }
  const used = { [TERRORIST]: 0, [COUNTER_TERRORIST]: 0 }

  for (const entity of combatants(context)) {
    const team = assignTeam(context, entity)
    // Before the spawn is chosen, not after: reviving hands back the standing
    // collider, and the height of that collider is what decides where the feet go.
    revive(context, entity)
    const list = spawns[team]
    if (list.length) placeAtSpawn(entity, list[used[team]++ % list.length])
    entity.velocityX = 0
    entity.velocityY = 0
    entity.velocityZ = 0
    entity.grounded = false
    entity.frozen = true
    entity.wishUse = false
    entity.hasBomb = false
    // Taken back off everybody first, or last round's carrier starts this one
    // holding a second C4 that nothing ever asked it to plant.
    const carrying = carryBag(entity)
    if (carrying) carrying.bomb = null

    const bag = record(context, entity)
    bag.anchor = { x: entity.x, y: entity.y, z: entity.z }
    bag.deathCounted = false
    bag.plantProgress = 0
    bag.defuseProgress = 0
    bag.plantAnchor = null
    bag.usedAt = -1e9
  }

  giveBomb(context)
  // Who was here when it started, so wiping a team that never had anybody on it
  // does not read as an elimination and end every round on the first step.
  context.match.roundStartAlive = {
    [TERRORIST]: aliveCount(context, TERRORIST),
    [COUNTER_TERRORIST]: aliveCount(context, COUNTER_TERRORIST)
  }
  context.play?.(SOUND.roundStart)
}

function goLive(context) {
  context.match.state.phase = 'live'
  for (const entity of combatants(context)) entity.frozen = false
}

function endRound(context, winner, reason) {
  const state = context.match.state
  if (state.phase !== 'live') return
  const loser = otherTeam(winner)

  state.phase = 'roundEnd'
  state.winner = winner
  state.reason = reason
  state.nextRoundAt = context.time + ROUND_END_SECONDS
  state[SCORE_KEY[winner]] += 1

  const streak = state[STREAK_KEY[loser]]
  const bonus = MONEY_LOSS_BONUS[Math.min(streak, MONEY_LOSS_BONUS.length - 1)]
  for (const entity of combatants(context)) {
    const team = teamOf(entity)
    if (team === winner) pay(context, entity, MONEY_ROUND_WIN, `won the round — ${reason}`)
    else if (team === loser) pay(context, entity, bonus, `lost the round — ${reason}`)
    // The ten seconds between rounds are yours to walk around in.
    entity.frozen = false
  }
  state[STREAK_KEY[loser]] = Math.min(streak + 1, MONEY_LOSS_BONUS.length - 1)
  state[STREAK_KEY[winner]] = 0

  if (state[SCORE_KEY[winner]] >= ROUNDS_TO_WIN) state.phase = 'matchEnd'
}

function swapSides(context) {
  const state = context.match.state
  state.sidesSwapped = true
  for (const entity of combatants(context)) {
    const team = otherTeam(teamOf(entity) ?? TERRORIST)
    entity.properties.team = team
    if (entity.damageable) entity.damageable.team = team
    // Halftime hands everybody the same 800 they started with. Carrying a
    // sixteen-thousand-dollar bank across the swap would decide the second half
    // before it began.
    entity.money = MONEY_START
  }
  // The score follows the players, not the side they happen to be standing on.
  const terrorist = state.scoreTerrorist
  state.scoreTerrorist = state.scoreCounterTerrorist
  state.scoreCounterTerrorist = terrorist
  state.lossStreakTerrorist = 0
  state.lossStreakCounterTerrorist = 0
}

// ------------------------------------------------------------------ dying
const resolveEntity = (context, who) =>
  typeof who === 'string' ? context.world.byId(who) : who

/**
 * Settle one death: mark it, drop the bomb if it was being carried, pay whoever
 * did it.
 *
 * Reached two ways on purpose. The damage lane calls `context.match.killed`,
 * which is the contract; and every step this plugin also looks for a body that
 * has gone `alive: false` without anyone saying so. A death the round never
 * heard about would silently skip the economy and the elimination check, and a
 * round that quietly refuses to end is the worst bug this file could have.
 */
function settleDeath(context, victim, killer, weapon) {
  if (!victim) return
  const bag = record(context, victim)
  if (bag.deathCounted) return
  bag.deathCounted = true

  if (victim.damageable && victim.damageable.alive !== false) victim.damageable.alive = false
  if (carriesBomb(victim)) dropBomb(context, victim)
  bag.plantProgress = 0
  bag.defuseProgress = 0
  victim.wishUse = false

  const shooter = resolveEntity(context, killer)
  const shooterTeam = shooter ? teamOf(shooter) : null
  if (!shooter || shooter === victim || !shooterTeam) return
  // A team kill pays nothing. 1.6 also fines the killer, but that fine belongs
  // beside the decision to allow friendly fire at all, which is not this lane's.
  if (shooterTeam === teamOf(victim)) return
  pay(context, shooter, killReward(context, weapon), `killed ${victim.id}`)
}

function noticeDeaths(context) {
  for (const entity of combatants(context)) {
    if (isAlive(entity)) continue
    if (record(context, entity).deathCounted) continue
    settleDeath(context, entity, entity.damageable?.lastHurtBy, null)
  }
}

// ------------------------------------------------------------------ the bomb
const plantedBomb = context => context.world.all('bomb')[0] || null

function dropBomb(context, victim) {
  const state = context.match.state
  victim.hasBomb = false
  const carrying = carryBag(victim)
  if (carrying) carrying.bomb = null
  state.bombCarrier = null
  // Where it fell, so the round is not over for the terrorists just because the
  // one carrying it walked into the wrong doorway.
  state.bombDropped = { x: victim.x, y: victim.y, z: victim.z }
}

function pickUpDroppedBomb(context) {
  const state = context.match.state
  if (!state.bombDropped || state.bombPlantedAt) return
  for (const entity of combatants(context)) {
    if (teamOf(entity) !== TERRORIST || !isAlive(entity)) continue
    if (onGroundDistance(entity, state.bombDropped) > PICKUP_REACH) continue
    entity.hasBomb = true
    state.bombCarrier = entity.id
    state.bombDropped = null
    context.weapons?.give?.(entity, 'c4')
    context.play?.(SOUND.pickup)
    return
  }
}

const onGroundDistance = (entity, point) => Math.hypot(entity.x - point.x, entity.z - point.z)

/** The bomb site an entity is standing in, by its centre. Null outside them all. */
function siteUnder(context, entity) {
  for (const site of context.world.all('bomb-site')) {
    const box = site.collider?.box
    if (!box || box.length < 3) continue
    const scale = site.scale ?? 1
    if (Math.abs(entity.x - site.x) > (box[0] * scale) / 2) continue
    if (Math.abs(entity.y - site.y) > (box[1] * scale) / 2) continue
    if (Math.abs(entity.z - site.z) > (box[2] * scale) / 2) continue
    return site
  }
  return null
}

function finishPlant(context, planter, site) {
  const state = context.match.state
  if (!context.world.types.has('bomb')) {
    console.error('[match-rules] cannot plant — there is no project/types/bomb.js')
    return
  }
  const bomb = context.spawn('bomb', {
    // A stable id, so an agent can read the planted bomb by name rather than by
    // guessing what the spawn counter was up to.
    id: 'bomb-planted',
    at: [planter.x, footOf(planter) + 0.11, planter.z],
    properties: { site: site.properties?.site ?? 'A' }
  })
  bomb.explodesAt = context.time + BOMB_SECONDS
  bomb.nextBeepAt = context.time

  state.bombPlantedAt = context.time
  state.bombExplodesAt = bomb.explodesAt
  state.bombSite = site.properties?.site ?? null
  state.bombCarrier = null
  state.plantProgress = 0

  planter.hasBomb = false
  const carrying = carryBag(planter)
  if (carrying) carrying.bomb = null
  const bag = record(context, planter)
  bag.plantProgress = 0
  bag.plantAnchor = null

  bomb.play?.('plant')
  pay(context, planter, MONEY_PLANT, 'planted the bomb')
}

function finishDefuse(context, bomb, defuser) {
  bomb.defused = true
  bomb.play?.('defused')
  context.match.state.defuseProgress = 0
  pay(context, defuser, MONEY_DEFUSE, 'defused the bomb')
}

/**
 * The blast, through the damage lane's own explosion. Guarded, because that lane
 * may not be loaded and a bomb that goes off hurting nobody is still a bomb that
 * won the round — the round must not depend on the damage arriving.
 */
function blast(context, bomb) {
  context.damage?.blast?.(bomb, {
    amount: BLAST_DAMAGE, radius: BLAST_RADIUS, from: bomb, weapon: 'c4'
  })
}

// ------------------------------------------------- planting and defusing
/**
 * One step of everybody's hands.
 *
 * Both jobs are the same gesture — hold `use` and stand still — so they share a
 * loop and the situation decides which one you are doing. Holding is a stamp
 * rather than a flag so that `entity.wishUse` written from an update hook and a
 * call to `context.match.hold(entity)` mean exactly the same thing.
 */
function runPlantAndDefuse(context, seconds) {
  const state = context.match.state
  const bomb = plantedBomb(context)
  let plantProgress = 0
  let defuseProgress = 0

  for (const entity of combatants(context)) {
    const bag = record(context, entity)
    if (entity.wishUse === true) bag.usedAt = context.time
    const holding = context.time - bag.usedAt <= HOLD_GRACE

    if (!holding || !isAlive(entity) || entity.frozen === true) {
      bag.plantProgress = 0
      bag.defuseProgress = 0
      bag.plantAnchor = null
      continue
    }

    if (bomb && !bomb.defused && !bomb.exploded && teamOf(entity) === COUNTER_TERRORIST) {
      if (onGroundDistance(entity, bomb) > DEFUSE_REACH || Math.abs(entity.y - bomb.y) > 2) {
        bag.defuseProgress = 0
        continue
      }
      bag.defuseProgress += seconds
      const needed = entity.hasDefuseKit ? DEFUSE_KIT_SECONDS : DEFUSE_SECONDS
      // Reported only while it is still going. A finished defuse reporting ten
      // seconds of progress would leave a full bar on screen for the step after
      // the bomb it belonged to stopped existing.
      if (bag.defuseProgress >= needed) finishDefuse(context, bomb, entity)
      else defuseProgress = Math.max(defuseProgress, bag.defuseProgress)
      continue
    }

    if (!bomb && teamOf(entity) === TERRORIST && carriesBomb(entity)) {
      const site = siteUnder(context, entity)
      // On the ground and inside the site, or there is nothing to plant. Falling
      // is not planting, and neither is standing in the doorway of the site.
      if (!site || entity.grounded !== true) {
        bag.plantProgress = 0
        bag.plantAnchor = null
        continue
      }
      if (bag.plantAnchor && onGroundDistance(entity, bag.plantAnchor) > PLANT_DRIFT) {
        bag.plantProgress = 0
        bag.plantAnchor = null
      }
      if (!bag.plantAnchor) {
        bag.plantAnchor = { x: entity.x, z: entity.z }
        // A short cooldown, or a terrorist walking across the site holding use
        // restarts the sound every third step.
        if (context.time - bag.plantSoundAt >= 0.5) {
          bag.plantSoundAt = context.time
          context.play?.(SOUND.plantStart)
        }
      }
      bag.plantProgress += seconds
      if (bag.plantProgress >= PLANT_SECONDS) finishPlant(context, entity, site)
      else plantProgress = Math.max(plantProgress, bag.plantProgress)
    }
  }

  state.plantProgress = round(plantProgress)
  state.defuseProgress = round(defuseProgress)
}

// ------------------------------------------------------------------ winning
/**
 * The four ways a round ends, in the order they are checked.
 *
 * The order is the rule. A round does NOT end when the timer expires if the
 * bomb is down, and killing the last terrorist does NOT end it either — the
 * counter-terrorists still have to walk up and cut the wire. Those two are the
 * entire tension of the last ten seconds of a round, and a version of this file
 * that got them wrong would still pass a casual look at the scoreboard.
 */
function checkWin(context) {
  const state = context.match.state
  const bomb = plantedBomb(context)

  if (bomb?.exploded) {
    blast(context, bomb)
    return endRound(context, TERRORIST, 'bomb exploded')
  }
  if (bomb?.defused) return endRound(context, COUNTER_TERRORIST, 'bomb defused')

  const planted = state.bombPlantedAt > 0
  const started = context.match.roundStartAlive

  if (started[COUNTER_TERRORIST] > 0 && aliveCount(context, COUNTER_TERRORIST) === 0) {
    return endRound(context, TERRORIST, 'counter-terrorists eliminated')
  }
  if (started[TERRORIST] > 0 && aliveCount(context, TERRORIST) === 0 && !planted) {
    return endRound(context, COUNTER_TERRORIST, 'terrorists eliminated')
  }
  if (!planted && context.time >= state.roundEndsAt) {
    return endRound(context, COUNTER_TERRORIST, 'time expired')
  }
}

// ------------------------------------------------------------------ freezing
/**
 * Freeze time, enforced rather than announced.
 *
 * `entity.frozen` is the field a movement lane is meant to read, but this runs
 * after physics in the same fixed step and puts every body back where the round
 * put it, so a lane that has not read it yet still cannot walk out of spawn.
 * Believing an announcement is how freeze time ends up being a suggestion.
 */
function holdStill(context) {
  for (const entity of combatants(context)) {
    entity.frozen = true
    entity.velocityX = 0
    entity.velocityY = 0
    entity.velocityZ = 0
    const anchor = record(context, entity).anchor
    if (!anchor) continue
    entity.x = anchor.x
    entity.y = anchor.y
    entity.z = anchor.z
  }
}

// ------------------------------------------------------------------ reporting
/**
 * Whose money goes on the screen, in four goes, most trustworthy first.
 *
 * Deliberately the same ladder the HUD and the radar climb, in the same order.
 * `world.state.money` is written here and the health beside it is written there,
 * and if the two lanes ever disagree about which body is yours the screen shows
 * one player's health next to another player's wallet — which looks like an
 * economy bug and is nothing of the kind.
 */
function findYou(context) {
  const world = context.world
  return context.camera?.target ||
    world.byId('you') ||
    world.entities.find(entity => !!entity['player-controlled']) ||
    world.entities.find(isCombatant) ||
    null
}

function report(context) {
  const state = context.match.state
  const bomb = plantedBomb(context)
  // The bomb owns its own fuse once it is in the ground, so the reported time
  // follows the entity rather than a copy of it that can drift.
  if (bomb && typeof bomb.explodesAt === 'number') state.bombExplodesAt = bomb.explodesAt

  const left = at => Math.max(0, Math.ceil(at - context.time))
  const you = findYou(context)

  Object.assign(context.world.state, {
    phase: state.phase,
    round: state.round,
    // Whole seconds, because a HUD that repaints sixty times a second to show
    // the same "1:54" is an easy way to make a 60fps game run at 40.
    roundTime: state.phase === 'freeze' ? ROUND_SECONDS : left(state.roundEndsAt),
    freezeTime: state.phase === 'freeze' ? left(state.freezeEndsAt) : 0,
    buyTime: left(state.buyEndsAt),
    scoreTerrorist: state.scoreTerrorist,
    scoreCounterTerrorist: state.scoreCounterTerrorist,
    aliveTerrorist: aliveCount(context, TERRORIST),
    aliveCounterTerrorist: aliveCount(context, COUNTER_TERRORIST),
    money: you && isCombatant(you) ? wallet(you) : 0,
    bombPlanted: state.bombPlantedAt > 0,
    bombTime: state.bombPlantedAt > 0 ? left(state.bombExplodesAt) : 0,
    match: state
  })
}

function summary(context) {
  const state = context.match.state
  return {
    ...state,
    time: round(context.time),
    aliveTerrorist: aliveCount(context, TERRORIST),
    aliveCounterTerrorist: aliveCount(context, COUNTER_TERRORIST),
    players: combatants(context).map(entity => ({
      id: entity.id,
      team: teamOf(entity),
      alive: isAlive(entity),
      money: wallet(entity),
      hasBomb: carriesBomb(entity),
      frozen: entity.frozen === true
    }))
  }
}

// ------------------------------------------------------------------ the plugin
export default {
  name: 'Match Rules',
  // So this runs after the bodies have moved: freeze time puts them back, and
  // putting them back before they move would not put them back at all.
  needs: ['Physics 3D'],

  onLoad(context) {
    const match = {
      state: freshState(),
      records: new Map(),
      roundStartAlive: { [TERRORIST]: 0, [COUNTER_TERRORIST]: 0 },
      reportedNoMatch: false,

      get phase() { return match.state.phase },

      money: entity => wallet(entity),
      pay: (entity, amount, reason) => pay(context, entity, amount, reason || 'no reason given'),
      killed: (victim, killer, weapon) => settleDeath(context, victim, killer, weapon),

      /**
       * One step of holding `use`. Plants if you are a terrorist with the bomb
       * standing in a site, defuses if you are a counter-terrorist next to one.
       * Setting `entity.wishUse` does the same thing, and is the door a human
       * and a bot already go through.
       */
      hold: entity => { if (entity) record(context, entity).usedAt = context.time },
      plant: entity => match.hold(entity),
      defuse: entity => match.hold(entity),
      bomb: () => plantedBomb(context)
    }
    context.match = match

    // Somebody has to be able to press it. The controls own these names; this
    // only fills the gap when nothing has bound `use` yet, because the symptom
    // otherwise is a bomb that simply never plants and no error anywhere. A real
    // binding replaces this one the moment it arrives.
    if (context.input && !context.input.codes('use').length) context.input.bind('use', ['KeyE'])

    context.bus.on('level:loaded', () => {
      match.state = freshState()
      match.records.clear()
      match.roundStartAlive = { [TERRORIST]: 0, [COUNTER_TERRORIST]: 0 }
      match.reportedNoMatch = false
      // `world.state` outlives a level load, so a HUD reading it would go on
      // showing the last map's score until the first step of the new one. Only
      // the keys that were already published are put back — a level that never
      // had a match should not acquire one's worth of zeroes by being opened.
      const published = context.world.state
      if (published && published.match) {
        Object.assign(published, {
          phase: 'warmup', round: 0, roundTime: 0, freezeTime: 0, buyTime: 0,
          scoreTerrorist: 0, scoreCounterTerrorist: 0,
          aliveTerrorist: 0, aliveCounterTerrorist: 0,
          money: 0, bombPlanted: false, bombTime: 0, match: match.state
        })
      }
    })
  },

  systems: [{
    phase: 'fixed',
    run(world, seconds, context) {
      const match = context.match
      if (!match) return
      const state = match.state

      if (state.phase === 'warmup') {
        if (canStart(context)) { beginMatch(context); report(context); return }
        // A map with sites and spawns that never starts a round is exactly the
        // silence this engine refuses to hand anybody. Say it once per load.
        if (!match.reportedNoMatch && world.all('bomb-site').length + world.all('spawn-point').length > 0) {
          match.reportedNoMatch = true
          console.error(`[match-rules] ${context.level()} has ${combatants(context).length} combatant(s) — a round needs one on each side, so this stays in warmup`)
        }
        return
      }

      if (state.phase === 'matchEnd') { report(context); return }

      if (state.phase === 'freeze' && context.time >= state.freezeEndsAt) goLive(context)
      else if (state.phase === 'roundEnd' && context.time >= state.nextRoundAt) beginRound(context, state.round + 1)

      if (state.phase === 'freeze') holdStill(context)

      if (state.phase === 'live') {
        noticeDeaths(context)
        pickUpDroppedBomb(context)
        runPlantAndDefuse(context, seconds)
        checkWin(context)
      }

      report(context)
    }
  }],

  commands: [
    {
      id: 'match.state',
      label: 'The round, the score and everyone in it',
      run: context => (context.match ? summary(context) : { error: 'no match rules loaded' })
    },
    {
      id: 'match.skip',
      label: 'Wind the round on — a number of seconds, or nothing to end the phase',
      /**
       * The verb that makes a two-minute round testable. `match.skip 30` on a
       * planted bomb puts you in the last five seconds of it, which is the part
       * of Counter-Strike worth looking at and the part nobody wants to wait
       * nearly two minutes to reach.
       */
      run: (context, seconds) => {
        const state = context.match?.state
        if (!state) return { error: 'no match rules loaded' }
        // From warmup the only thing ahead is round one, so skip forward into
        // it. A headless `run match.skip` starts a world that has not stepped
        // yet, and answering "nothing to skip" there would be true and useless.
        if (state.phase === 'warmup') {
          if (!canStart(context)) return { error: `${context.level()} has no combatant on each side to play a round` }
          beginMatch(context)
          report(context)
          if (typeof seconds !== 'number') return summary(context)
        }
        if (state.phase === 'matchEnd') return { error: 'the match is over — load the level again for another' }
        const bomb = plantedBomb(context)
        if (typeof seconds === 'number') {
          state.freezeEndsAt -= seconds
          state.roundEndsAt -= seconds
          state.nextRoundAt -= seconds
          if (bomb) {
            bomb.explodesAt -= seconds
            // The beep has to keep up with a fuse that just jumped, or it stays
            // silent until the old interval runs out.
            bomb.nextBeepAt = context.time
          }
        } else if (state.phase === 'freeze') state.freezeEndsAt = context.time
        else if (state.phase === 'roundEnd') state.nextRoundAt = context.time
        else if (state.phase === 'live') state.roundEndsAt = context.time
        return summary(context)
      }
    },
    {
      id: 'match.round',
      label: 'Start a given round — a number, or { round, scoreTerrorist, scoreCounterTerrorist }',
      run: (context, argument) => {
        const state = context.match?.state
        if (!state) return { error: 'no match rules loaded' }
        if (state.phase === 'warmup') {
          if (!canStart(context)) return { error: `${context.level()} has no combatant on each side to play a round` }
          beginMatch(context)
        }
        const wanted = typeof argument === 'number' ? { round: argument } : (argument || {})
        if (typeof wanted.scoreTerrorist === 'number') state.scoreTerrorist = wanted.scoreTerrorist
        if (typeof wanted.scoreCounterTerrorist === 'number') state.scoreCounterTerrorist = wanted.scoreCounterTerrorist
        if (typeof wanted.round === 'number') beginRound(context, wanted.round)
        report(context)
        return summary(context)
      }
    }
  ]
}

const round = n => Math.round(n * 1000) / 1000
