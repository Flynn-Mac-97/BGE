/**
 * The round, the bomb and the money.
 *
 * Every one of these is a rule you cannot see by looking at the game: freeze
 * time either holds you or it does not, a bomb either survives the round clock
 * or it does not, and a loss bonus either climbs or quietly pays 1400 forever.
 * All of them look identical on screen for the first ten seconds, and all of
 * them ruin the game if they are wrong.
 *
 * Two things this test does deliberately.
 *
 * It takes the hands off the ten bodies the map ships — nine bot brains and one
 * player — and then drives them itself. A round cannot be reasoned about while
 * ten opinions are walking around in it, and the rules under test are about the
 * round rather than about who wins the fight inside it.
 *
 * It kills people by writing `damageable.alive = false` rather than by shooting
 * them. That IS the contract: match rules call nothing and ask nothing, they
 * read the one field the damage lane publishes, and a death nobody announced
 * still has to end the round.
 */

// The clock the rules are built on, restated here rather than imported, so this
// file fails loudly if project/plugins/match-rules.js quietly changes one.
const FREEZE_SECONDS = 6
const BOMB_SECONDS = 35
const MONEY_START = 800
const MONEY_ROUND_WIN = 3250
const MONEY_PLANT = 800
const MONEY_DEFUSE = 300
const LOSS_LADDER = [1400, 1900, 2400, 2900, 3400]

// The middle of bomb site A, and the height of the floor under it. Both are
// asserted by the de_dust2 test, so if the map moves, that one fails first.
const SITE_X = 0
const SITE_Z = -22
const SITE_FLOOR = 1.3

export default {
  name: 'the round holds you, ends four ways, and pays a ladder that resets',
  level: 'de_dust2',

  run(test) {
    const idsOnTeam = team => test.entities
      .filter(entity => entity.damageable && entity.properties?.team === team)
      .map(entity => entity.id)

    const terrorists = idsOnTeam('terrorist')
    const counterTerrorists = idsOnTeam('counter-terrorist')
    test.ok(terrorists.length > 0 && counterTerrorists.length > 0,
      `de_dust2 fields ${terrorists.length} terrorists and ${counterTerrorists.length} counter-terrorists`)

    // Hands off the controls. What is left is ten bodies on two sides.
    for (const id of [...terrorists, ...counterTerrorists]) {
      test.detach(id, 'bot-brain')
      test.detach(id, 'player-controlled')
    }

    const state = () => test.state.match
    const step = () => test.simulate(1 / 60)
    const kill = ids => {
      for (const id of ids) {
        const bag = test.entity(id).damageable
        if (!bag) continue
        bag.health = 0
        bag.alive = false
      }
    }
    /** Round end and freeze time both wound forward, the way `match.skip` does. */
    const nextRound = () => {
      state().nextRoundAt = 0
      step()
      state().freezeEndsAt = 0
      step()
    }

    // ------------------------------------------------------------ round one
    step()
    test.is(state().round, 1, 'the first step of a map with two sides on it starts round one')
    test.is(state().phase, 'freeze', 'and a round starts frozen')
    test.is(test.state.phase, 'freeze', 'which the HUD reads straight out of world.state')
    test.is(test.entity(terrorists[0]).money, MONEY_START, 'everybody starts a match with 800')
    test.is(state().bombPlantedAt, 0, 'and nothing is in the ground yet')

    const carrier = test.entity(state().bombCarrier)
    test.ok(!!carrier && carrier.properties.team === 'terrorist',
      'one terrorist is handed the C4 at the start of the round')
    test.is(carrier.hasBomb, true, 'and says so on the entity, where anything can read it')

    // ------------------------------------------- freeze time blocks movement
    const held = test.entity(terrorists[0])
    const home = { x: held.x, y: held.y, z: held.z }
    test.is(held.frozen, true, 'freeze time says so on the entity')

    test.at(held.id, home.x + 3, home.y + 2)
    held.velocityX = 6
    test.simulate(1)
    test.near(held.x, home.x, 0.001, 'frozen: shoved out of spawn, it is put straight back')
    test.near(held.y, home.y, 0.001, 'frozen: and gravity cannot pull it down either')

    // ------------------------------------------------------- and then releases
    test.simulate(FREEZE_SECONDS)
    test.is(state().phase, 'live', 'six seconds of freeze time and the round goes live')
    test.is(held.frozen, false, 'the body is let go')
    test.at(held.id, home.x, home.y + 2)
    test.simulate(0.5)
    test.ok(held.y < home.y + 0.5, `released: it falls again, to ${round(held.y)} m`)

    // --------------------------- eliminating a team ends it, and pays both sides
    const wonWith = test.entity(terrorists[0]).money
    const lostWith = test.entity(counterTerrorists[1]).money
    kill(counterTerrorists)
    step()
    test.is(state().phase, 'roundEnd', 'wiping a side ends the round')
    test.is(state().winner, 'terrorist', 'and the side still standing takes it')
    test.is(state().reason, 'counter-terrorists eliminated', 'for the reason it actually happened')
    test.is(state().scoreTerrorist, 1, 'the score follows')
    test.is(test.entity(terrorists[0]).money - wonWith, MONEY_ROUND_WIN, 'winning a round pays 3250')
    test.is(test.entity(counterTerrorists[1]).money - lostWith, LOSS_LADDER[0], 'and a first loss pays 1400')

    // ------------------------------- the clock running out, with nothing planted
    nextRound()
    test.is(state().round, 2, 'the next round comes round on its own')
    test.is(state().phase, 'live', 'and goes live when freeze time is over')
    test.is(state().bombPlantedAt, 0, 'nobody planted this one')
    state().roundEndsAt = 0
    step()
    test.is(state().phase, 'roundEnd', 'the round clock running out ends it')
    test.is(state().winner, 'counter-terrorist', 'with the bomb still in a pocket, the defenders take it')
    test.is(state().reason, 'time expired', 'and it says so')

    // ------------------------------------------------------- planting the bomb
    nextRound()
    const planter = test.entity(state().bombCarrier)
    const beforePlant = planter.money
    standAt(test, planter.id, SITE_X, SITE_Z)
    test.is(planter.grounded, true, 'the terrorist with the bomb is standing on the floor of A')

    planter.wishUse = true
    test.simulate(1)
    test.is(test.count('bomb'), 0, 'one second on the button plants nothing')
    test.ok(state().plantProgress > 0.9, `but the plant is under way — ${state().plantProgress}s of it`)

    planter.wishUse = false
    test.simulate(0.2)
    test.near(state().plantProgress, 0, 0.001, 'letting go loses every second of it')

    planter.wishUse = true
    test.simulate(3.1)
    test.is(test.count('bomb'), 1, 'three unbroken seconds puts the bomb in the ground')
    test.is(state().bombSite, 'A', 'and the round knows which site it went into')
    test.is(planter.hasBomb, false, 'the planter is not carrying it any anymore')
    test.is(planter.money - beforePlant, MONEY_PLANT, 'planting pays the planter 800')
    test.near(state().bombExplodesAt - state().bombPlantedAt, BOMB_SECONDS, 0.001,
      'and the fuse is thirty-five seconds')
    test.ok(test.state.bombTime > 30, `the HUD can see the fuse — ${test.state.bombTime}s left`)

    // ------------------------ a planted bomb outlives the clock and the planters
    state().roundEndsAt = 0
    step()
    test.is(state().phase, 'live', 'a planted bomb keeps the round alive past the round clock')
    kill(terrorists)
    step()
    test.is(state().phase, 'live', 'and killing the last terrorist does not end it either')

    // Wind the fuse down rather than sitting through thirty-five seconds — the
    // same move `match.skip 30` makes from the command line.
    const bomb = test.entity('bomb-planted')
    bomb.explodesAt = state().bombPlantedAt + 1
    test.simulate(0.4)
    test.is(state().phase, 'live', 'the bomb does not go off early')
    test.simulate(0.8)
    test.is(state().phase, 'roundEnd', 'and it goes off when its fuse says')
    test.is(state().winner, 'terrorist', 'which is a terrorist round')
    test.is(state().reason, 'bomb exploded', 'won by the bomb, not by the bodies')

    // ---------------------------------------------------- defusing it in time
    nextRound()
    const secondPlanter = test.entity(state().bombCarrier)
    standAt(test, secondPlanter.id, SITE_X, SITE_Z)
    secondPlanter.wishUse = true
    test.simulate(3.1)
    test.is(test.count('bomb'), 1, 'planted again, to cut the wire this time')
    secondPlanter.wishUse = false
    kill(terrorists)

    const defuser = test.entity(counterTerrorists[1])
    standAt(test, defuser.id, SITE_X + 1, SITE_Z)
    const beforeDefuse = defuser.money

    defuser.wishUse = true
    test.simulate(4)
    test.is(state().phase, 'live', 'four seconds on the wire is not ten')
    test.ok(state().defuseProgress > 3.9, `but it is being worked on — ${state().defuseProgress}s`)
    defuser.wishUse = false
    test.simulate(0.2)
    test.near(state().defuseProgress, 0, 0.001, 'and letting go loses all four of them')

    defuser.wishUse = true
    test.simulate(10.2)
    test.is(state().phase, 'roundEnd', 'ten unbroken seconds cuts the wire')
    test.is(state().winner, 'counter-terrorist', 'which is a counter-terrorist round')
    test.is(state().reason, 'bomb defused', 'won on the bomb rather than on the clock')
    test.is(defuser.money - beforeDefuse, MONEY_ROUND_WIN + MONEY_DEFUSE,
      'and the defuser is paid 300 on top of the round')

    // --------------------------------------- the loss ladder, over five rounds
    // The wallet is zeroed before each one so the reading is the payment itself
    // rather than a running total creeping towards the 16000 ceiling.
    const bank = counterTerrorists[1]
    const ladder = []
    for (let i = 0; i < LOSS_LADDER.length; i++) {
      nextRound()
      test.set(bank, 'money', 0)
      kill(counterTerrorists)
      step()
      ladder.push(test.entity(bank).money)
    }
    test.is(ladder, LOSS_LADDER, 'five straight losses walk up the ladder and stop at the top')

    nextRound()
    test.set(bank, 'money', 0)
    kill(terrorists)
    step()
    test.is(test.entity(bank).money, MONEY_ROUND_WIN, 'winning one pays the round, not a bonus')
    test.is(state().lossStreakCounterTerrorist, 0, 'and wipes the streak')

    nextRound()
    test.set(bank, 'money', 0)
    kill(counterTerrorists)
    step()
    test.is(test.entity(bank).money, LOSS_LADDER[0], 'so the next loss starts at the bottom again')
  }
}

/**
 * Put one body on the floor of the A site and let it settle.
 *
 * Dropped a metre rather than placed exactly, because `grounded` is something
 * physics decides by landing and a body set down on the exact resting height has
 * never touched anything. Planting requires ground under your feet, so a plant
 * that failed for want of a landing would be a very confusing test.
 */
function standAt(test, id, x, z) {
  test.at(id, x, SITE_FLOOR + 2)
  test.set(id, 'z', z)
  test.simulate(0.8)
}

const round = n => Math.round(n * 1000) / 1000
