/**
 * Counter-Strike HUD — everything the player looks at except the world itself.
 *
 * Health and armour bottom left, ammunition bottom right, money above health,
 * the round timer and both scores across the top, the kill feed top right and
 * the crosshair in the middle. The radar is its own plugin, because it is the
 * one part of this that has to understand the map; the gun in your hands is
 * `weapon-models.js`, because it is the one part that is not drawn in 2D.
 *
 * ---------------------------------------------------------------------------
 * Two jobs, two systems, and the split is the important part of this file.
 *
 *   the FIXED system reads the world and produces one plain reading — health,
 *   armour, magazine, reserve, money, the clock, the kill feed, the crosshair
 *   gap. It also advances every animation, on the fixed clock, so a replay
 *   animates identically.
 *
 *   the FRAME system draws that reading and nothing else. It computes nothing.
 *
 * That is what lets the whole HUD be tested with no screen: `simulate` runs the
 * fixed system, so the numbers exist in `context.world.state` and in the reading
 * below whether or not there is a canvas. A HUD that only existed as pixels
 * would need a browser and a screenshot to check a single number.
 *
 * ---------------------------------------------------------------------------
 * Why this one repaints every frame, when the built-in Heads Up Display only
 * repaints on change.
 *
 * The built-in HUD draws text that changes when the score changes, so caching a
 * key and skipping the paint is free. Nothing here holds still: the crosshair
 * gap eases toward the current inaccuracy, the kill feed fades, the hurt rim
 * fades, the bomb light blinks. A change-detection key would differ on
 * essentially every frame anyway, so it would cost a JSON stringify per frame
 * and save nothing. Instead the paint is skipped wholesale in the two cases
 * where it really is idle: when the game is not running, and when this is not a
 * Counter-Strike level.
 */

/**
 * The live HUD, for a test to read.
 *
 * A test file is handed the `test` object and nothing else, so it can reach
 * neither `context` nor this plugin's state. A plugin module is a singleton in
 * node and in the browser alike, so importing this file from `project/tests`
 * reaches the very object the running world is using — the same arrangement
 * `plugins/builtin/camera.js` uses, and for the same reason.
 */
let running = null
export const runningCounterStrikeHud = () => running

const TERRORIST = 'terrorist'
const COUNTER_TERRORIST = 'counter-terrorist'

/** 1.6's palette. The team colours are the ones the radar dots use too. */
const COLOUR = {
  number: '#b9c9dd',        // the pale blue-white the 1.6 numbers are drawn in
  dim: '#6d7f93',
  money: '#4ce04c',
  hurt: '#e04b3c',
  bomb: '#e04b3c',
  crosshair: '#00ff2a',
  terrorist: '#e0a03c',
  counterTerrorist: '#6ea8e0'
}

/** How long the health and money numbers stay flashed after they change. */
const FLASH_SECONDS = 0.45

/** A kill feed line lives about five seconds, and spends the last one fading. */
const KILL_FEED_SECONDS = 5
const KILL_FEED_FADE = 1
const KILL_FEED_MAX = 5

/**
 * The crosshair gap, in pixels at unit scale, decomposed into what opens it.
 *
 * The gap is the game telling you that you cannot hit anything right now, so
 * every term here corresponds to something the player can stop doing: slow
 * down, land, stop holding the trigger.
 */
const CROSSHAIR_BASE = 5
const CROSSHAIR_MOVE = 11
const CROSSHAIR_AIR = 14
const CROSSHAIR_SPRAY = 13
const CROSSHAIR_WEAPON = 16
const CROSSHAIR_EASE = 0.07     // the gap eases toward the target, never snaps
const CROUCH_TIGHTEN = 0.75     // ducking is the cheapest accuracy in the game
const SPRAY_FULL = 10           // shots into a burst at which spray is maxed out
const RUN_SPEED = 6.35          // Counter-Strike's run, in metres per second

const SPECTATE_AFTER = 2        // how long you look at your own corpse before the camera moves

export default {
  name: 'Counter-Strike HUD',
  // Ordering only. Every one of these is still guarded at the point of use,
  // because a plugin that is switched off in the Plugin Browser must degrade
  // the HUD rather than take it down.
  needs: ['Heads Up Display', 'Game Camera'],

  onLoad(context) {
    const hud = freshHud()
    running = { hud, context }

    // A level load throws away everything derived from the old map: whose HUD
    // this is, what the map is made of, who was alive. Keeping any of it would
    // show the last round's kill feed over the new round.
    context.bus.on('level:loaded', () => {
      const kept = hud.reported
      Object.assign(hud, freshHud())
      hud.reported = kept
      // The built-in HUD clears its own extras on a level load, and it does so
      // after an await, so re-adding here would race it. The fixed system puts
      // the lines back when it notices they are gone instead.
      if (context.hud && hud.tookOverHud) context.hud.visible = true
    })
  },

  systems: [
    {
      phase: 'fixed',
      run(world, seconds, context) {
        const hud = running?.hud
        if (hud) readTheWorld(hud, world, seconds, context)
      }
    },
    {
      phase: 'frame',
      run(world, seconds, context) {
        const hud = running?.hud
        if (!hud?.active) return
        // Nothing to draw while the level is being edited: the HUD would sit on
        // top of the thing you are trying to select.
        if (!context.loop.running && !context.hud?.always) return
        const layer = ensureLayer(hud, context)
        if (layer) paint(layer, hud, context)
      }
    }
  ],

  commands: [
    {
      id: 'counter-strike-hud.read',
      label: 'Every number the Counter-Strike HUD is drawing',
      run: () => {
        const hud = running?.hud
        if (!hud) return { error: 'the Counter-Strike HUD plugin has not loaded' }
        // Every number here is produced on the fixed step, so a world that has
        // not been stepped genuinely has nothing to say. Distinguish that from
        // "this is not a Counter-Strike level", because they need different fixes.
        if (!hud.active) {
          return {
            active: false,
            why: hud.counterStrikeLevel === null
              ? 'the world has not been stepped yet — simulate at least one step'
              : 'this level has no bomb sites and team spawns, or no player to draw a HUD for'
          }
        }
        return {
          active: true,
          ...hud.reading,
          crosshairGap: round(hud.crosshairGap),
          killFeed: hud.killFeed.map(line => `${line.killer} [${line.weapon}] ${line.victim}`)
        }
      }
    }
  ]
}

/** Everything the HUD knows, in one bag, so a level load is one assignment. */
function freshHud() {
  return {
    active: false,
    counterStrikeLevel: null,   // null until the map has been looked at once
    youId: null,
    tookOverHud: false,
    items: null,                // the lines registered with the built-in HUD
    reported: new Set(),        // problems already said out loud, so we say each once
    reading: emptyReading(),

    aliveWas: new Map(),        // entity id -> was it alive last step
    killFeed: [],
    killedBy: '',
    diedAt: null,
    spectating: false,

    crosshairGap: CROSSHAIR_BASE,
    crosshairTarget: CROSSHAIR_BASE,

    hurtUntil: 0,
    moneyFlashUntil: 0,
    blindUntil: 0,
    blindAmount: 0,
    blindFrom: 0,
    lastHealth: null,
    lastMoney: null,

    layer: null
  }
}

function emptyReading() {
  return {
    team: null,
    health: 0, armour: 0, helmet: false, alive: true,
    weaponId: '', weaponSlot: '', weaponName: '', magazine: 0, reserve: 0, ammunition: '',
    money: 0,
    phase: 'warmup', roundClock: '', roundSeconds: null,
    scoreTerrorist: 0, scoreCounterTerrorist: 0,
    aliveTerrorist: 0, aliveCounterTerrorist: 0,
    bombPlanted: false, bombSite: null,
    blinded: 0,
    killedBy: ''
  }
}

// --------------------------------------------------------------- the reading
/**
 * Read the world once and write down what the HUD is about to draw.
 *
 * Everything here is a plain field read. This plugin cannot ask the damage
 * behaviour or the weapons plugin a question — it reads `entity.damageable`
 * and `entity.carriesWeapons`, which are the bags those lanes agreed to keep
 * their numbers in, and it copes with either of them not existing yet.
 */
function readTheWorld(hud, world, seconds, context) {
  const state = world.state

  if (hud.counterStrikeLevel === null) hud.counterStrikeLevel = looksLikeCounterStrike(world)

  // Who "you" are is decided once and then held, because the camera moves to a
  // team mate when you die and the HUD must keep showing your death, not theirs.
  if (!hud.youId || !world.byId(hud.youId)) {
    hud.youId = findYou(world, context)?.id || null
  }
  const you = hud.youId ? world.byId(hud.youId) : null

  const active = !!(you && hud.counterStrikeLevel)
  if (active !== hud.active) hud.active = active
  if (!active) {
    // Hand the screen back. A level with no Counter-Strike in it gets the
    // built-in HUD it declared.
    if (hud.tookOverHud && context.hud) { context.hud.visible = true; hud.tookOverHud = false }
    return
  }

  takeOverTheBuiltInHud(hud, context)

  const reading = hud.reading
  const damageable = you.damageable || {}
  const carried = carryOf(you) || {}

  reading.team = teamOf(you)
  reading.health = Math.max(0, Math.round(number(damageable.health, 100)))
  reading.armour = Math.max(0, Math.round(number(damageable.armour, 0)))
  reading.helmet = damageable.helmet === true
  reading.alive = damageable.alive !== false

  const weapon = carried.current || null
  const record = weaponRecord(weapon, hud, context)
  reading.weaponId = weapon || ''
  // Reported rather than drawn: "which slot is out" is the question an agent
  // asks of `counter-strike-hud.read` when the ammunition looks wrong, and it is
  // taken from the weapons table rather than guessed from the name — "Desert
  // Eagle" does not contain the word pistol.
  reading.weaponSlot = record?.slot || record?.kind || ''
  reading.weaponName = record?.name || (weapon ? String(weapon).toUpperCase() : '')
  reading.magazine = Math.max(0, Math.round(number(carried.ammo, 0)))
  reading.reserve = Math.max(0, Math.round(number(carried.reserve, 0)))
  reading.ammunition = `${reading.magazine} / ${reading.reserve}`
  reading.money = Math.round(moneyOf(you, hud, context))
  readTheFlash(reading, hud, damageable, context)

  readTheMatch(reading, hud, context)
  countTheLiving(reading, world, context)

  // Flashes. Health flashes on the way down only — a medkit is good news and
  // does not need the same alarm as being shot.
  if (hud.lastHealth !== null && reading.health < hud.lastHealth) hud.hurtUntil = context.time + FLASH_SECONDS
  if (hud.lastMoney !== null && reading.money !== hud.lastMoney) hud.moneyFlashUntil = context.time + FLASH_SECONDS
  hud.lastHealth = reading.health
  hud.lastMoney = reading.money

  watchForKills(hud, world, context)
  reading.killedBy = hud.killedBy
  spectateWhenDead(hud, world, context)

  advanceCrosshair(hud, you, carried, seconds)

  publish(state, reading, hud, context)
}

/**
 * A map is a Counter-Strike map when it has bomb sites and team spawns in it.
 *
 * Derived from the level rather than declared, so this HUD cannot appear over
 * `level1` and cannot fail to appear over a new map somebody adds tomorrow. It
 * deliberately does not test the player for a team: the player lane may not
 * have set one yet, and a HUD that waits for another lane shows nothing at all.
 */
function looksLikeCounterStrike(world) {
  const sites = world.all('bomb-site').length
  const spawns = world.all('spawn-point').some(entity => !!entity.properties?.team)
  return sites > 0 && spawns
}

/**
 * The built-in HUD keeps the numbers; this plugin keeps the pixels.
 *
 * `hud.read` is how an agent — and the terminal — asks what the HUD says, and
 * it reads the item list rather than any canvas. So the lines are registered
 * there, and the built-in painter is switched off while this one is drawing,
 * because otherwise the same six numbers would be drawn twice in two different
 * places. One set of numbers, two consumers.
 */
function takeOverTheBuiltInHud(hud, context) {
  const builtIn = context.hud
  if (!builtIn) {
    once(hud, 'no-hud', 'the Heads Up Display plugin is not loaded, so "hud.read" cannot report these numbers. The screen still draws.')
    return
  }

  if (!hud.items) {
    hud.items = [
      { text: 'HEALTH {health}' },
      { text: 'ARMOUR {armour}' },
      { text: '{weaponName} {ammunition}' },
      { text: '${money}' },
      { text: 'ROUND {roundClock}' },
      { text: 'TERRORIST {scoreTerrorist} - {scoreCounterTerrorist} COUNTER-TERRORIST' },
      { text: 'ALIVE {aliveTerrorist} - {aliveCounterTerrorist}' }
    ]
  }

  // Checked every step rather than registered once, because a level load clears
  // the extras from inside an async handler this plugin cannot order itself
  // against. Noticing they are gone is cheaper than winning that race.
  if (!builtIn.extra.includes(hud.items[0])) for (const item of hud.items) builtIn.add(item)

  if (!hud.tookOverHud) {
    hud.tookOverHud = true
    builtIn.visible = false
    console.info('[counter-strike-hud] drawing the Counter-Strike HUD, so the built-in HUD painter is off for this level. "hud.read" still reports every number.')
  }
}

/**
 * The flashbang, which the damage lane leaves on the victim for whatever draws.
 *
 * `damageable` records how white it was at its worst and when it ends, and
 * deliberately does not decay it — a number that only makes sense while it is
 * being drawn belongs to the thing drawing it. So the start of each flash is
 * noted here, and the whiteout holds for the first fifth and then fades, which
 * is what a real flashbang does and what 1.6 modelled.
 */
function readTheFlash(reading, hud, damageable, context) {
  const until = number(damageable.blindUntil, 0)
  const amount = clamp(number(damageable.blindAmount, 0), 0, 1)
  if (until > hud.blindUntil) hud.blindFrom = context.time
  hud.blindUntil = until
  hud.blindAmount = amount

  const span = until - hud.blindFrom
  if (!(span > 0) || context.time >= until) { reading.blinded = 0; return }
  const left = (until - context.time) / span
  reading.blinded = round(amount * Math.min(1, left / 0.8))
}

/** The round, from the match lane if it is there and from nothing if it is not. */
function readTheMatch(reading, hud, context) {
  const match = context.match
  const matchState = safely(hud, 'match-state', () => match?.state) || {}

  reading.phase = safely(hud, 'match-phase', () => match?.phase) || 'warmup'
  reading.scoreTerrorist = Math.round(number(matchState.scoreTerrorist, 0))
  reading.scoreCounterTerrorist = Math.round(number(matchState.scoreCounterTerrorist, 0))
  reading.bombSite = matchState.bombSite || null

  const plantedAt = number(matchState.bombPlantedAt, NaN)
  reading.bombPlanted = Number.isFinite(plantedAt) && plantedAt > 0

  const endsAt = number(matchState.roundEndsAt, NaN)
  if (Number.isFinite(endsAt)) {
    reading.roundSeconds = Math.max(0, endsAt - context.time)
    reading.roundClock = clock(reading.roundSeconds)
  } else {
    // The match lane owns the clock. Saying "--:--" is honest; inventing a
    // countdown here would give the player a number nothing else agrees with.
    reading.roundSeconds = null
    reading.roundClock = '--:--'
  }
}

/**
 * How many of each side are still standing.
 *
 * The match lane publishes this when it is running, and it is the authority on
 * who counts as a combatant, so its numbers are read rather than second-guessed.
 * Counting here is the fallback for a world with no match in it — which is the
 * state a map is in while somebody is building it.
 */
function countTheLiving(reading, world, context) {
  if (context.match && Number.isFinite(world.state.aliveTerrorist)) {
    reading.aliveTerrorist = world.state.aliveTerrorist
    reading.aliveCounterTerrorist = number(world.state.aliveCounterTerrorist, 0)
    return
  }

  reading.aliveTerrorist = 0
  reading.aliveCounterTerrorist = 0
  for (const entity of world.entities) {
    if (!isCombatant(entity)) continue
    if (entity.damageable && entity.damageable.alive === false) continue
    const team = teamOf(entity)
    if (team === TERRORIST) reading.aliveTerrorist++
    else if (team === COUNTER_TERRORIST) reading.aliveCounterTerrorist++
  }
}

/**
 * The kill feed, built from watching `damageable.alive` fall over.
 *
 * There is no kill event to subscribe to, and inventing one would mean the
 * match lane and this one both had to know about it. Watching a plain field
 * change is exactly how two lanes are supposed to agree in this engine, it
 * needs nothing from anybody, and it cannot report a kill that did not happen.
 *
 * The one thing it cannot see is a victim that is destroyed rather than marked
 * dead. If the match lane ever removes bodies outright, this needs the entity
 * to survive one step with `alive: false` on it.
 */
function watchForKills(hud, world, context) {
  for (const entity of world.entities) {
    if (!isCombatant(entity)) continue
    const alive = entity.damageable ? entity.damageable.alive !== false : true
    const was = hud.aliveWas.get(entity.id)
    hud.aliveWas.set(entity.id, alive)
    if (was !== true || alive) continue

    const killer = resolveEntity(world, entity.damageable?.lastHurtBy)
    const line = {
      killer: nameOf(killer) || 'the world',
      killerTeam: teamOf(killer),
      victim: nameOf(entity),
      victimTeam: teamOf(entity),
      // The victim's own record of the last hit first: it names the weapon that
      // actually did it, where the killer's hands may already hold something
      // else by the time this line is drawn.
      weapon: weaponName(entity.damageable?.lastWeapon || carryOf(killer)?.current, hud, context) || '',
      headshot: entity.damageable?.lastHitbox === 'head',
      at: context.time
    }
    hud.killFeed.push(line)
    if (hud.killFeed.length > KILL_FEED_MAX) hud.killFeed.shift()

    if (entity.id === hud.youId) {
      hud.killedBy = line.killer
      hud.diedAt = context.time
      hud.spectating = false
    }
  }

  // Fade out by dropping, not by leaving them at zero alpha — a list that only
  // grows is a leak that shows up as a slow frame an hour into a match.
  if (hud.killFeed.length) {
    hud.killFeed = hud.killFeed.filter(line => context.time - line.at < KILL_FEED_SECONDS)
  }
}

/**
 * Death gives you somebody else's eyes.
 *
 * Through `context.camera.follow`, which is the same public call any other
 * plugin would make — there is no private path from the HUD into the camera.
 */
function spectateWhenDead(hud, world, context) {
  if (hud.reading.alive) {
    hud.diedAt = null
    hud.spectating = false
    hud.killedBy = ''
    return
  }
  if (hud.spectating || hud.diedAt === null) return
  if (context.time - hud.diedAt < SPECTATE_AFTER) return

  const mine = teamOf(world.byId(hud.youId))
  const target = world.entities.find(entity =>
    isCombatant(entity) &&
    entity.id !== hud.youId &&
    entity.damageable?.alive !== false &&
    (!mine || teamOf(entity) === mine))

  hud.spectating = true
  if (!target) return
  safely(hud, 'spectate', () => context.camera?.follow(target))
}

// ------------------------------------------------------------- the crosshair
/**
 * Four lines and a gap, and the gap is the honest part.
 *
 * The four states the weapons lane actually fires by are the four states this
 * draws: standing, moving, crouching and airborne, plus how far into a spray
 * the trigger is. Every one of them is read off a plain field somebody else
 * already writes — the velocity physics integrates, `crouched` from the
 * movement behaviour, `grounded` from physics, `shotsFired` from the carrying
 * bag — so the picture and the bullet cannot drift apart. The one thing no lane
 * publishes is the weapon's own cone; if one ever writes a 0-to-1
 * `entity.inaccuracy`, this picks it up with no further change.
 *
 * The terms add rather than take a maximum, because in Counter-Strike running
 * and spraying really are worse than either alone.
 */
function advanceCrosshair(hud, you, carried, seconds) {
  const speed = groundSpeed(you)

  let target = CROSSHAIR_BASE
  target += Math.min(1, speed / RUN_SPEED) * CROSSHAIR_MOVE
  if (you.grounded === false) target += CROSSHAIR_AIR
  target += Math.min(1, Math.max(0, number(carried.shotsFired, 0)) / SPRAY_FULL) * CROSSHAIR_SPRAY
  target += Math.min(1, Math.max(0, number(you.inaccuracy, 0))) * CROSSHAIR_WEAPON
  // Ducking is the cheapest accuracy in the game and the crosshair has to say
  // so, or nobody learns to do it.
  if (you.crouched === true) target *= CROUCH_TIGHTEN

  hud.crosshairTarget = target
  // Eased, never snapped: a crosshair that jumped to its new size would read as
  // a glitch rather than as the gun settling.
  hud.crosshairGap += (target - hud.crosshairGap) * (1 - Math.exp(-seconds / CROSSHAIR_EASE))
}

// ------------------------------------------------------------- shared state
/**
 * The numbers, into `world.state`, where `{name}` and `hud.read` can reach them.
 *
 * One writer per key. The scores, the phase, the alive counts, the money and
 * whether the bomb is down all belong to `match-rules`, which publishes them
 * itself — so they are read above and drawn, and written here only when there
 * is no match plugin to own them, which is the state a map is in while somebody
 * is still building it. Two lanes writing one key is how a number starts
 * flickering between two opinions of it, and nobody can see which is winning.
 */
function publish(state, reading, hud, context) {
  if (!context.match) {
    state.money = reading.money
    state.aliveTerrorist = reading.aliveTerrorist
    state.aliveCounterTerrorist = reading.aliveCounterTerrorist
    state.bombPlanted = reading.bombPlanted ? 1 : 0
  }

  state.team = reading.team
  state.health = reading.health
  state.armour = reading.armour
  state.helmet = reading.helmet ? 1 : 0
  state.alive = reading.alive ? 1 : 0
  state.weaponName = reading.weaponName
  state.magazine = reading.magazine
  state.reserve = reading.reserve
  state.ammunition = reading.ammunition
  state.roundClock = reading.roundClock
  state.roundSeconds = reading.roundSeconds === null ? null : round(reading.roundSeconds)
  state.blinded = reading.blinded
  state.killedBy = reading.killedBy
  state.crosshairGap = round(hud.crosshairGap)
  state.killFeed = hud.killFeed.length
}

// ------------------------------------------------------------------ the layer
/**
 * A 2D canvas sitting exactly on the viewport, and nothing else.
 *
 * The same arrangement the built-in HUD uses and for the same reasons: the GL
 * canvas cannot draw text without a font atlas, and a DOM overlay of styled
 * elements would be a second renderer with its own coordinates. Its own
 * element rather than a shared container, because two plugins drawing into one
 * node is a shared-mutable-DOM bug waiting to happen.
 */
function ensureLayer(hud, context) {
  if (typeof document === 'undefined') return null

  const existing = hud.layer
  if (existing && document.contains(existing.canvas)) return existing

  const host = context.shell?.viewport
  if (!host) {
    once(hud, 'no-viewport', 'there is no viewport to attach the HUD canvas to, so nothing is drawn. Every number is still in world.state and in "hud.read".')
    return null
  }

  const canvas = existing?.canvas || document.createElement('canvas')
  canvas.className = 'counter-strike-hud-layer'
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none'
  host.prepend(canvas)
  // After the GL canvas and after the built-in HUD's layer, so this draws on
  // top of the world; still before the transform gizmo's overlay, so selection
  // handles stay above everything.
  const under = host.querySelector('.hud-layer') || host.querySelector('#gl')
  if (under) under.after(canvas)

  const layer = { canvas, g: canvas.getContext('2d') }
  hud.layer = layer
  return layer
}

// ------------------------------------------------------------------ drawing
function paint(layer, hud, context) {
  const { canvas, g } = layer
  const ratio = Math.min(devicePixelRatio || 1, 2)
  const width = canvas.clientWidth
  const height = canvas.clientHeight
  if (!width || !height) return
  if (canvas.width !== width * ratio || canvas.height !== height * ratio) {
    canvas.width = width * ratio
    canvas.height = height * ratio
  }

  g.setTransform(ratio, 0, 0, ratio, 0, 0)
  g.clearRect(0, 0, width, height)

  // One scale for the whole HUD, from the height, so a small window gets a
  // small HUD rather than one that covers the game.
  const unit = clamp(height / 720, 0.7, 2)
  const screen = { width, height, unit, time: context.time }

  drawCrosshair(g, hud, screen)
  drawHurt(g, hud, screen)
  drawTopBar(g, hud, screen)
  drawKillFeed(g, hud, screen)
  drawHealthAndArmour(g, hud, screen)
  drawMoney(g, hud, screen)
  drawAmmunition(g, hud, screen)
  drawDeath(g, hud, screen)
  // Last, and over everything: a flashbang blinds you to your own HUD too.
  drawFlash(g, hud, screen)
}

function drawFlash(g, hud, screen) {
  const amount = hud.reading.blinded
  if (amount <= 0) return
  g.fillStyle = `rgba(255,255,255,${clamp(amount, 0, 1)})`
  g.fillRect(0, 0, screen.width, screen.height)
}

/**
 * Text with a dark outline, so the same HUD is readable over bright sand and
 * over a black tunnel without anybody choosing a colour per map. Numbers are
 * monospaced on purpose: a proportional "111" is narrower than "888", and a
 * health counter that shuffles sideways as it ticks down is maddening.
 */
const NUMBER_FONT = 'ui-monospace, "DejaVu Sans Mono", monospace'
const LABEL_FONT = '"Arial Narrow", "Helvetica Neue", Arial, sans-serif'

function write(g, text, x, y, options = {}) {
  const size = options.size || 16
  g.font = `${options.weight || 700} ${size}px ${options.font || NUMBER_FONT}`
  g.textAlign = options.align || 'left'
  g.textBaseline = options.baseline || 'alphabetic'
  g.globalAlpha = options.alpha ?? 1
  g.lineWidth = Math.max(2, size / 7)
  g.lineJoin = 'round'
  g.strokeStyle = 'rgba(0,0,0,0.8)'
  g.strokeText(text, x, y)
  g.fillStyle = options.colour || COLOUR.number
  g.fillText(text, x, y)
  g.globalAlpha = 1
  return g.measureText(text).width
}

function drawCrosshair(g, hud, screen) {
  const centreX = screen.width / 2
  const centreY = screen.height / 2
  const gap = hud.crosshairGap * screen.unit
  const arm = 7 * screen.unit
  const thickness = Math.max(1, Math.round(2 * screen.unit))

  g.globalAlpha = hud.reading.alive ? 1 : 0.25
  g.fillStyle = COLOUR.crosshair
  // Four lines and a hole. Drawn as rectangles rather than strokes so the arms
  // land on whole pixels and stay crisp at any gap.
  g.fillRect(centreX - gap - arm, centreY - thickness / 2, arm, thickness)
  g.fillRect(centreX + gap, centreY - thickness / 2, arm, thickness)
  g.fillRect(centreX - thickness / 2, centreY - gap - arm, thickness, arm)
  g.fillRect(centreX - thickness / 2, centreY + gap, thickness, arm)
  g.globalAlpha = 1
}

/** A red rim when you are hit. Brief, and at the edges, so it never hides the shot. */
function drawHurt(g, hud, screen) {
  const left = hud.hurtUntil - screen.time
  if (left <= 0) return
  const strength = clamp(left / FLASH_SECONDS, 0, 1) * 0.5
  const band = Math.min(screen.width, screen.height) * 0.22
  const fade = g.createLinearGradient(0, 0, 0, band)
  fade.addColorStop(0, `rgba(190,30,20,${strength})`)
  fade.addColorStop(1, 'rgba(190,30,20,0)')
  g.fillStyle = fade
  g.fillRect(0, 0, screen.width, band)
  g.save()
  g.translate(0, screen.height)
  g.scale(1, -1)
  g.fillStyle = fade
  g.fillRect(0, 0, screen.width, band)
  g.restore()
}

/** Top centre: the clock, with each side's score and how many of them are left. */
function drawTopBar(g, hud, screen) {
  const { unit } = screen
  const reading = hud.reading
  const centreX = screen.width / 2
  const top = 14 * unit

  const panelWidth = 260 * unit
  const panelHeight = 46 * unit
  const planted = reading.bombPlanted

  g.fillStyle = planted ? 'rgba(120,20,16,0.72)' : 'rgba(8,12,18,0.55)'
  roundedRectangle(g, centreX - panelWidth / 2, top, panelWidth, panelHeight, 6 * unit)
  g.fill()

  // The clock, and a bomb beside it once the bomb is down. The red panel and
  // the icon together are the change a player notices without reading anything.
  const clockX = planted ? centreX + 9 * unit : centreX
  write(g, reading.roundClock, clockX, top + 33 * unit, {
    size: 26 * unit, align: 'center', colour: planted ? '#ffd0c8' : COLOUR.number
  })
  if (planted) drawBombIcon(g, centreX - 44 * unit, top + 13 * unit, 20 * unit, screen.time)

  const scoreY = top + 33 * unit
  write(g, `${reading.scoreTerrorist}`, centreX - panelWidth / 2 - 16 * unit, scoreY, {
    size: 26 * unit, align: 'right', colour: COLOUR.terrorist
  })
  write(g, `${reading.aliveTerrorist} alive`, centreX - panelWidth / 2 - 16 * unit, scoreY + 15 * unit, {
    size: 11 * unit, align: 'right', colour: COLOUR.dim, font: LABEL_FONT
  })
  write(g, `${reading.scoreCounterTerrorist}`, centreX + panelWidth / 2 + 16 * unit, scoreY, {
    size: 26 * unit, align: 'left', colour: COLOUR.counterTerrorist
  })
  write(g, `${reading.aliveCounterTerrorist} alive`, centreX + panelWidth / 2 + 16 * unit, scoreY + 15 * unit, {
    size: 11 * unit, align: 'left', colour: COLOUR.dim, font: LABEL_FONT
  })
}

function drawKillFeed(g, hud, screen) {
  const { unit } = screen
  const right = screen.width - 18 * unit
  let y = 22 * unit

  for (const line of hud.killFeed) {
    const age = screen.time - line.at
    const alpha = clamp((KILL_FEED_SECONDS - age) / KILL_FEED_FADE, 0, 1)
    if (alpha <= 0) continue

    const size = 15 * unit
    g.font = `700 ${size}px ${LABEL_FONT}`
    const victimWidth = g.measureText(line.victim).width
    const weaponLabel = ` ${line.weapon || 'kill'}${line.headshot ? ' *' : ''} `
    g.font = `600 ${size * 0.85}px ${LABEL_FONT}`
    const weaponWidth = g.measureText(weaponLabel).width

    write(g, line.victim, right, y + size, {
      size, align: 'right', alpha, font: LABEL_FONT, colour: teamColour(line.victimTeam)
    })
    write(g, weaponLabel, right - victimWidth, y + size, {
      size: size * 0.85, align: 'right', alpha, font: LABEL_FONT, colour: COLOUR.dim
    })
    write(g, line.killer, right - victimWidth - weaponWidth, y + size, {
      size, align: 'right', alpha, font: LABEL_FONT, colour: teamColour(line.killerTeam)
    })
    y += size * 1.5
  }
}

function drawHealthAndArmour(g, hud, screen) {
  const { unit } = screen
  const reading = hud.reading
  const left = 26 * unit
  const baseline = screen.height - 26 * unit
  const hurt = hud.hurtUntil > screen.time
  const size = 40 * unit

  drawHealthIcon(g, left, baseline - size * 0.62, size * 0.5, hurt)
  write(g, `${reading.health}`, left + size * 0.78, baseline, {
    size, colour: hurt ? COLOUR.hurt : COLOUR.number
  })

  const armourX = left + size * 3.1
  drawArmourIcon(g, armourX, baseline - size * 0.62, size * 0.5, reading.helmet)
  write(g, `${reading.armour}`, armourX + size * 0.78, baseline, { size, colour: COLOUR.number })
}

function drawMoney(g, hud, screen) {
  const { unit } = screen
  const flashing = hud.moneyFlashUntil > screen.time
  write(g, `$${hud.reading.money}`, 26 * unit, screen.height - 78 * unit, {
    size: (flashing ? 26 : 22) * unit,
    colour: flashing ? '#c8ffc8' : COLOUR.money
  })
}

function drawAmmunition(g, hud, screen) {
  const { unit } = screen
  const reading = hud.reading
  const right = screen.width - 26 * unit
  const baseline = screen.height - 26 * unit

  write(g, reading.weaponName || '', right, baseline - 44 * unit, {
    size: 16 * unit, align: 'right', colour: COLOUR.dim, font: LABEL_FONT
  })
  // The magazine is the number you look at mid-fight, so it is the large one
  // and the reserve is deliberately quieter.
  const reserveWidth = write(g, ` / ${reading.reserve}`, right, baseline, {
    size: 26 * unit, align: 'right', colour: COLOUR.dim
  })
  write(g, `${reading.magazine}`, right - reserveWidth, baseline, {
    size: 40 * unit, align: 'right', colour: reading.magazine === 0 ? COLOUR.hurt : COLOUR.number
  })
}

function drawDeath(g, hud, screen) {
  if (hud.reading.alive) return
  const { unit } = screen
  g.fillStyle = 'rgba(0,0,0,0.35)'
  g.fillRect(0, 0, screen.width, screen.height)

  const y = screen.height * 0.36
  write(g, `You were killed by ${hud.killedBy || 'the world'}`, screen.width / 2, y, {
    size: 24 * unit, align: 'center', colour: '#e8dcc8', font: LABEL_FONT
  })
  if (hud.spectating) {
    write(g, 'spectating', screen.width / 2, y + 26 * unit, {
      size: 14 * unit, align: 'center', colour: COLOUR.dim, font: LABEL_FONT
    })
  }
}

// ------------------------------------------------------------------- icons
/** A cross, the way every health pickup since 1993 has drawn one. */
function drawHealthIcon(g, x, y, size, hurt) {
  const arm = size / 3
  g.fillStyle = hurt ? COLOUR.hurt : COLOUR.number
  g.globalAlpha = 0.9
  g.fillRect(x + arm, y, arm, size)
  g.fillRect(x, y + arm, size, arm)
  g.globalAlpha = 1
}

/** A shield, with a notch across the top when the helmet is on. */
function drawArmourIcon(g, x, y, size, helmet) {
  g.fillStyle = COLOUR.number
  g.globalAlpha = 0.9
  g.beginPath()
  g.moveTo(x + size / 2, y)
  g.lineTo(x + size, y + size * 0.25)
  g.lineTo(x + size * 0.5, y + size)
  g.lineTo(x, y + size * 0.25)
  g.closePath()
  g.fill()
  if (helmet) {
    g.fillStyle = 'rgba(8,12,18,0.85)'
    g.fillRect(x + size * 0.18, y + size * 0.26, size * 0.64, size * 0.12)
  }
  g.globalAlpha = 1
}

/** The C4: a block, a strap and a light that blinks on the fixed clock. */
function drawBombIcon(g, x, y, size, time) {
  g.fillStyle = '#f0e0d0'
  g.fillRect(x, y + size * 0.2, size * 0.8, size * 0.6)
  g.fillStyle = 'rgba(40,10,8,0.9)'
  g.fillRect(x, y + size * 0.42, size * 0.8, size * 0.1)
  g.fillStyle = Math.floor(time * 2) % 2 ? '#ff5040' : '#601810'
  g.beginPath()
  g.arc(x + size * 0.4, y + size * 0.32, size * 0.1, 0, Math.PI * 2)
  g.fill()
}

// ------------------------------------------------------------------ helpers
/**
 * Whose HUD this is, in three goes, most trustworthy first.
 *
 * The camera's target is the real answer — whatever the level said to follow is
 * by definition the body you are looking out of. Before the level's follow rule
 * has landed, `player-controlled` is the behaviour that makes a body yours, and
 * asking for it is the same question the buy menu asks. The first combatant is
 * a last resort so a half-built map still draws a HUD instead of silently
 * drawing nothing.
 *
 * An id is deliberately not one of the answers. This drew the HUD for
 * `world.byId('you')` — right for de_dust2 and wrong for every map after it,
 * exactly as reading `player-0` was right for the platformer and wrong for
 * this one. A behaviour survives the map being redrawn; a name does not.
 */
function findYou(world, context) {
  return context.camera?.target ||
    world.entities.find(entity => entity.behaviours?.some(attached => attached.name === 'player-controlled')) ||
    world.entities.find(isCombatant) ||
    null
}

/**
 * Both spellings of the carrying bag.
 *
 * The engine files a behaviour's bag under its file name, so it is really at
 * `entity['carries-weapons']`; the contract every lane was handed says
 * `entity.carriesWeapons`. `carries-weapons` points both at one object once it
 * has started, and this reads either so the HUD is right before it has.
 */
const carryOf = entity => entity?.carriesWeapons || entity?.['carries-weapons'] || null

/**
 * How fast this body is going across the ground.
 *
 * From the velocity physics actually integrates rather than from the movement
 * behaviour's own `moveSpeed`, which is that lane's figure for what it asked
 * for. When you run into a wall the two disagree, and the crosshair should
 * close, because you have stopped.
 */
const groundSpeed = entity => Math.hypot(number(entity.velocityX, 0), number(entity.velocityZ, 0))

/** Types that are people even before the damage lane has given them a bag. */
const COMBATANT_TYPES = new Set(['player', 'bot', 'terrorist', 'counter-terrorist'])

const isCombatant = entity =>
  !!entity && (!!entity.damageable || !!carryOf(entity) || COMBATANT_TYPES.has(entity.type))

const teamOf = entity => entity?.properties?.team || entity?.damageable?.team || null

const teamColour = team =>
  team === TERRORIST ? COLOUR.terrorist
    : team === COUNTER_TERRORIST ? COLOUR.counterTerrorist
      : COLOUR.dim

/**
 * What to call somebody in the kill feed.
 *
 * No lane publishes player names yet, so this falls back to the entity id —
 * which reads as `you` and `terrorist-3`, and is at least true. `name` and
 * `properties.name` are read first so that the moment a lane starts writing
 * one, the feed uses it with no change here.
 */
const nameOf = entity => entity?.properties?.name || entity?.name || entity?.id || null

/** `lastHurtBy` may be an entity or an id — the bag shape does not say which. */
const resolveEntity = (world, who) =>
  typeof who === 'string' ? world.byId(who) : (who && typeof who === 'object' ? who : null)

/** The weapons lane's entry for a weapon, or nothing when that lane is absent. */
function weaponRecord(id, hud, context) {
  if (!id) return null
  return safely(hud, 'weapons-get', () => context.weapons?.get?.(id)) || null
}

/** What to call the weapon. The weapons lane knows; without it, the id will do. */
function weaponName(id, hud, context) {
  if (!id) return ''
  return weaponRecord(id, hud, context)?.name || String(id).toUpperCase()
}

function moneyOf(entity, hud, context) {
  const paid = safely(hud, 'match-money', () => context.match?.money?.(entity))
  if (Number.isFinite(paid)) return paid
  return number(entity.money, number(entity.properties?.money, 0))
}

/**
 * Call into another lane without letting it take the HUD down.
 *
 * A system that throws is disabled by name — so one bad frame from a lane that
 * is still being written would blank the whole screen. Report it once, by name,
 * and keep drawing.
 */
function safely(hud, key, read) {
  try {
    return read()
  } catch (e) {
    once(hud, key, `${key} threw (${e?.message || e}) — that part of the HUD is showing its fallback`)
    return undefined
  }
}

function once(hud, key, message) {
  if (hud.reported.has(key)) return
  hud.reported.add(key)
  console.error(`[counter-strike-hud] ${message}`)
}

function roundedRectangle(g, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2)
  g.beginPath()
  g.moveTo(x + r, y)
  g.arcTo(x + width, y, x + width, y + height, r)
  g.arcTo(x + width, y + height, x, y + height, r)
  g.arcTo(x, y + height, x, y, r)
  g.arcTo(x, y, x + width, y, r)
  g.closePath()
}

const clock = seconds => {
  const whole = Math.max(0, Math.floor(seconds))
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

const number = (value, fallback) => (Number.isFinite(value) ? value : fallback)
const clamp = (value, low, high) => Math.max(low, Math.min(high, value))
const round = value => Math.round(value * 1000) / 1000
