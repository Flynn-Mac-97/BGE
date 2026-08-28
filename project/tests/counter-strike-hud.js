/**
 * The Counter-Strike HUD and radar, asserted on the DATA rather than on pixels.
 *
 * Every number this checks is produced by the two plugins' FIXED systems and
 * written into `world.state` and into their own readings, which is exactly why
 * the whole HUD can be tested with no screen at all. A test that needed a canvas
 * would need a browser, a screenshot and a human, and it would then be the one
 * test nobody runs.
 *
 * A test file is handed the `test` object and nothing else, so it cannot reach
 * `context`. Both plugins export a handle for this — the same arrangement
 * `plugins/builtin/camera.js` uses, and it works because a plugin module is a
 * singleton in node and in the browser alike.
 *
 * The HUD reads the other lanes through plain fields — the `damageable` and
 * `carries-weapons` bags, and `context.match` — so this test writes those
 * fields and asserts the HUD reports them back. What is under test is that the
 * HUD consumes the contract, not that the damage, weapons or match lanes
 * produce it. Where a lane IS loaded its own numbers are read and the HUD is
 * checked against them rather than against a copy of them: replacing a running
 * plugin's object would throw inside that plugin's own system and get it
 * disabled for the rest of the run.
 *
 * de_dust2 is a live round with ten bodies in it, so nothing here asserts an
 * absolute count of anything. It arranges its own entities, pins them before
 * every step, and asserts about those — which is the only kind of assertion
 * that survives another lane deciding the map should have twelve players in it.
 */
import { runningCounterStrikeHud } from '../plugins/counter-strike-hud.js'
import { runningRadar } from '../plugins/radar.js'

const STEP = 1 / 60

export default {
  name: 'the HUD reports health, armour, ammunition, money and the round; the crosshair opens when you move; the kill feed fades; the radar shows only what your team can see',
  level: 'de_dust2',

  async run(test) {
    const liveHud = runningCounterStrikeHud()
    const liveRadar = runningRadar()
    if (!liveHud) return test.ok(false, 'the Counter-Strike HUD plugin is loaded')
    if (!liveRadar) return test.ok(false, 'the Radar plugin is loaded')

    const { hud, context } = liveHud
    const radar = liveRadar.radar

    // Whose HUD this is. The camera's target is the answer once the level's
    // follow rule has landed; before that, the honest question is which body a
    // human is driving, and `player-controlled` is what answers it. Never a
    // type and never an id: `player-0` was the platformer's, `you` is this
    // map's, and both go stale the next time the map is redrawn — the behaviour
    // does not.
    const driven = test.entities.filter(entity =>
      entity.behaviours?.some(attached => attached.name === 'player-controlled'))
    const you = context.camera?.target || driven[0]
    if (!you) return test.ok(false, 'de_dust2 has a body carrying player-controlled for a human to look out of')
    test.is(driven.length, 1, 'exactly one body in de_dust2 is player-controlled')
    test.is(you.id, driven[0].id, 'and it is the one the camera is looking out of')

    // The level says `"follow": "you"`, and the camera reads that from the level
    // file asynchronously — which a test does not wait for. Point it by hand, so
    // the world is in the state a real session is in a moment later. It matters
    // for more than the camera: `match-rules` decides whose money to publish
    // from `camera.target` too, and the two lanes must be talking about the same
    // body or the HUD shows one player's health beside another's wallet.
    if (context.camera && !context.camera.target) context.camera.follow(you)

    // Stand in only when nothing is there. See the note above.
    const restoreMatch = context.match ? () => {} : standInForMatch(context, test)
    const alive = () => {
      const damageable = bag(you, 'damageable')
      damageable.alive = true
      if (!(damageable.health > 0)) damageable.health = 78
    }

    try {
      // Half a second first, so every `start` hook has run and this test's
      // numbers land on top of whatever the other lanes set up rather than
      // underneath it.
      run(test, 0.5, alive)
      test.ok(hud.active, 'the HUD switched itself on for a Counter-Strike level')

      // ------------------------------------------------------- what it says
      you.money = 3450                     // read only if the match lane is absent
      Object.assign(bag(you, 'damageable'), { health: 78, armour: 45, helmet: true, alive: true })
      Object.assign(bag(you, 'carries-weapons'), {
        current: 'ak47', ammo: 24, reserve: 60, shotsFired: 0, reloadingUntil: 0
      })
      you.carriesWeapons = you['carries-weapons']
      // Set, then read back from wherever it ends up: the match lane owns the
      // round and is entitled to move its own deadline.
      if (context.match?.state) context.match.state.roundEndsAt = context.time + 95.5

      // Exactly one step between writing these and reading them, so nothing else
      // has had a chance to have an opinion about them.
      test.simulate(STEP)

      const lines = await context.run('hud.read')
      const weaponLabel = weaponName(context, 'ak47')
      const money = moneyNow(context, you)
      const endsAt = context.match?.state?.roundEndsAt ?? 0
      const clock = minutesAndSeconds(Math.max(0, endsAt - context.time))

      test.ok(lines.includes('HEALTH 78'), 'hud.read reports health')
      test.ok(lines.includes('ARMOUR 45'), 'hud.read reports armour')
      test.is(lines.find(line => line.includes('24 / 60')), `${weaponLabel} 24 / 60`,
        'hud.read reports the weapon and its magazine over its reserve')
      test.is(lines.find(line => line.startsWith('$')), `$${money}`, 'hud.read reports money with a dollar sign')
      test.ok(lines.includes(`ROUND ${clock}`), 'hud.read reports the round timer')
      test.ok(/^\d+:\d\d$/.test(clock), `and counts it down from the deadline as m:ss (${clock})`)

      test.is(test.state.health, 78, 'world.state carries health for {health}')
      test.is(test.state.armour, 45, 'and armour')
      test.is(test.state.ammunition, '24 / 60', 'and the ammunition')
      test.near(test.state.roundSeconds, Math.max(0, endsAt - context.time), 0.001, 'and the round in seconds')
      test.ok(test.state.aliveCounterTerrorist >= 1, 'and counts you among the living counter-terrorists')

      // ---------------------------------------------------- the crosshair gap
      // The gap is the game telling you that you cannot hit anything, so the
      // assertion worth making is that moving opens it and stopping closes it.
      // Velocity is written again before every step because the movement
      // behaviour sets it from the input each step, and this test is about the
      // crosshair rather than about how a player moves.
      const still = () => { alive(); you.velocityX = 0; you.velocityZ = 0 }
      run(test, 0.7, still)
      const atRest = test.state.crosshairGap

      const anchorX = you.x
      const anchorZ = you.z
      run(test, 0.35, () => {
        alive()
        you.x = anchorX
        you.z = anchorZ
        you.velocityX = 6.35      // Counter-Strike's run, in metres per second
      })
      const running = test.state.crosshairGap

      test.ok(running > atRest + 2,
        `the crosshair gap opens while moving (${round(atRest)} at rest, ${round(running)} running)`)

      run(test, 0.7, still)
      test.near(test.state.crosshairGap, atRest, 0.5, 'and closes again once you stop')

      // ------------------------------------------------------- the kill feed
      const victim = spawnCombatant(test, 'terrorist', [you.x + 3, you.y, you.z])
      run(test, 2 * STEP, still)
      test.ok(!hud.killFeed.some(line => line.victim === victim.id), 'nobody has killed the new terrorist yet')

      // A kill, seen the way the HUD sees one: a plain field falling over.
      victim.damageable.alive = false
      victim.damageable.lastHurtBy = you.id
      victim.damageable.lastHitbox = 'head'
      const feedBefore = test.state.killFeed
      test.simulate(STEP)

      test.is(test.state.killFeed, feedBefore + 1, 'a kill puts a line in the feed')
      const line = hud.killFeed.find(entry => entry.victim === victim.id)
      test.ok(!!line, 'and the line names the victim')
      test.is(line?.killer, you.id, 'and the killer, read from damageable.lastHurtBy')
      test.is(line?.headshot, true, 'and marks it a headshot, read from damageable.lastHitbox')

      run(test, 5.2, still)
      test.ok(!hud.killFeed.some(entry => entry.victim === victim.id),
        'and about five seconds later the line has faded out of the feed')

      test.destroy(victim.id)

      // ------------------------------------------------------------ the radar
      // Somewhere with three metres of clear air in front, found by asking the
      // same raycast the radar asks rather than by hoping the map has not moved.
      const open = clearDirection(context, you)
      if (!open) return test.ok(false, 'the player is standing somewhere with room to see')

      const mate = spawnCombatant(test, teamOf(you), [you.x, you.y, you.z])
      // Facing the other way, and saying so through `aimYaw` — the plain field a
      // bot brain writes. Without one the radar deliberately credits a team mate
      // with seeing everything it has a clear line to, which would make the
      // "turn your back and lose the dot" check below meaningless.
      mate.aimYaw = open.yaw + Math.PI
      const enemy = spawnCombatant(test, other(teamOf(you)), [you.x, you.y, you.z])

      // Everything is placed relative to where you actually are, every step,
      // because freeze time puts bodies back on their spawns and this test must
      // not care which side of that it is running on.
      let range = 60
      let yaw = open.yaw
      const arrange = () => {
        still()
        context.view.yaw = yaw
        put(mate, you, open.direction, -2)
        put(enemy, you, open.direction, range)
      }

      // Long enough for at least one of the radar's ten-a-second sweeps.
      run(test, 0.2, arrange)
      test.is(test.state.radarDots, radar.dots.length, 'world.state.radarDots is the number of dots the radar has')
      test.is(test.state.radarEnemies, radar.dots.filter(dot => dot.kind === 'enemy').length, 'and radarEnemies is how many of them are enemies')
      test.ok(radar.dots.some(dot => dot.id === mate.id && dot.kind === 'friend'), 'your team mate is a friend dot')
      test.ok(!radar.dots.some(dot => dot.id === enemy.id), 'and an enemy sixty metres away is not on it at all')

      range = 3
      run(test, 0.2, arrange)
      test.ok(radar.dots.some(dot => dot.id === enemy.id && dot.kind === 'enemy'),
        'an enemy in plain sight three metres ahead gets an enemy dot')
      test.is(test.state.radarDots, radar.dots.length, 'and the published count still matches the dots')
      test.is(radar.dots.filter(dot => dot.kind === 'you').length, 1, 'exactly one dot is you')

      // It is line of sight that earns the dot, not proximity: turning your back
      // on somebody two paces away should lose them.
      yaw = open.yaw + Math.PI
      run(test, 0.2, arrange)
      test.ok(!radar.dots.some(dot => dot.id === enemy.id),
        'nobody on your team is looking at the enemy any more, so the dot goes')
    } finally {
      restoreMatch()
    }
  }
}

/**
 * A match, for a HUD to read, and only when there is no real one.
 *
 * The HUD guards every call into the match lane, so it draws without one — but
 * then the round timer has nothing to count down and this test could say
 * nothing interesting about it.
 */
function standInForMatch(context, test) {
  const state = {
    phase: 'live',
    round: 1,
    scoreTerrorist: 2,
    scoreCounterTerrorist: 1,
    roundEndsAt: 0,
    bombPlantedAt: 0,
    bombSite: null
  }
  context.match = { state, phase: 'live', money: () => 3450, pay: () => {}, killed: () => {} }
  test.note('match-rules is not loaded — this test stands in for it so the round timer has a deadline')
  return () => { context.match = undefined }
}

/** Step the world, arranging the scene immediately before every single step. */
function run(test, seconds, arrange) {
  for (let i = 0; i < Math.max(1, Math.round(seconds * 60)); i++) {
    arrange?.()
    test.simulate(STEP)
  }
}

/** A body of a given side, standing exactly where it is put. */
function spawnCombatant(test, team, at) {
  // The real body type, minus its brain: a bot that walked away mid-assertion
  // would make this test about pathfinding.
  const entity = test.spawn(team, { at, behaviours: { 'bot-brain': false } })
  entity.properties.team = team
  Object.assign(bag(entity, 'damageable'), { health: 100, armour: 0, alive: true, team })
  return entity
}

/** Put one body a fixed distance from another, along a direction, at the same height. */
function put(entity, from, direction, metres) {
  entity.x = from.x + direction.x * metres
  entity.z = from.z + direction.z * metres
  entity.y = from.y
  entity.velocityX = 0
  entity.velocityY = 0
  entity.velocityZ = 0
}

/**
 * Which way there is room to see.
 *
 * The player's spawn belongs to the map lane, so asking the world beats
 * hard-coding a compass bearing that goes stale the next time a wall moves.
 */
function clearDirection(context, you) {
  const eye = { x: you.x, y: you.y + 0.7, z: you.z }
  // Yaw 0 faces -Z and positive yaw turns left — stated once in
  // plugins/builtin/camera.js, and the convention the radar reads.
  const options = [
    { yaw: 0, direction: { x: 0, y: 0, z: -1 } },
    { yaw: Math.PI, direction: { x: 0, y: 0, z: 1 } },
    { yaw: -Math.PI / 2, direction: { x: 1, y: 0, z: 0 } },
    { yaw: Math.PI / 2, direction: { x: -1, y: 0, z: 0 } }
  ]
  if (!context.raycast) return options[0]
  return options.find(option => !context.raycast(eye, option.direction, 5, { ignore: [you] })) || null
}

/** What the weapons lane calls this weapon, or the id shouted — exactly as the HUD does. */
function weaponName(context, id) {
  try {
    const found = context.weapons?.get?.(id)
    if (found?.name) return found.name
  } catch { /* the HUD falls back the same way */ }
  return id.toUpperCase()
}

/** What the match lane says you have, or the plain field — exactly as the HUD does. */
function moneyNow(context, you) {
  try {
    const paid = context.match?.money?.(you)
    if (Number.isFinite(paid)) return Math.round(paid)
  } catch { /* the HUD falls back the same way */ }
  return Math.round(you.money || 0)
}

const teamOf = entity => entity?.properties?.team || entity?.damageable?.team || 'counter-terrorist'
const other = team => (team === 'terrorist' ? 'counter-terrorist' : 'terrorist')

const minutesAndSeconds = seconds => {
  const whole = Math.max(0, Math.floor(seconds))
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

/** A behaviour's bag, made here if the lane that owns it has not landed yet. */
const bag = (entity, name) => entity[name] || (entity[name] = {})

const round = value => Math.round(value * 100) / 100
