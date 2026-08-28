/**
 * The plugin is imported for the live menu, not for a copy of it.
 *
 * A test is handed a `test` object and no context, and every rule worth
 * checking here lives on `context.buyMenu`. Rebuilding a price list in this
 * file would let it pass happily while the menu the game runs was wrong, which
 * is the same reason `project/tests/mouse-look.js` reaches into Mouse Look for
 * the real input surface rather than making a second accumulator.
 *
 * Refusals are asserted by their `refused` word rather than by their sentence.
 * The sentence is for the player and may be reworded; the word is the reason,
 * and checking it is what stops "refused because he is a terrorist" passing as
 * "refused because he is broke".
 */
import { buyMenu } from '../plugins/buy-menu.js'

/** Stand exactly on a spawn — which is where a buy zone is drawn. */
const standAt = (entity, spawn) => {
  entity.x = spawn.x
  entity.y = spawn.y
  entity.z = spawn.z
}

/** A standing player, in metres. Only needed for a body this test spawns itself. */
const PLAYER_BOX = { box: [0.8, 1.83, 0.8] }

export default {
  name: 'the buy menu charges the right money, refuses the other team’s rifle, and B 4 3 is still an AK-47',
  level: 'de_dust2',

  run(test) {
    const menu = buyMenu.menu
    if (!test.ok(menu, 'Buy Menu loaded and published the menu the game itself uses')) return

    // The spawns are read out of the level rather than written down here. Where
    // a team starts is the map lane's to decide and it may well move; that a
    // buy zone is wherever your own team starts is this plugin's rule, and that
    // is the one being tested.
    const spawnFor = team =>
      test.entities.find(e => e.type === 'spawn-point' && e.properties?.team === team)
    const terroristSpawn = spawnFor('terrorist')
    const counterTerroristSpawn = spawnFor('counter-terrorist')
    if (!test.ok(terroristSpawn && counterTerroristSpawn, 'de_dust2 still has a spawn for each team')) return

    // Both buyers are fitted out before the first step, because `start` runs
    // once for everything in the world and a bag made by `carries-weapons` is
    // what `give` puts a weapon into. An entity spawned after that first step
    // would never be started and would have nothing to carry.
    const carrying = entity => {
      if (!entity.behaviours.some(b => b.name === 'carries-weapons')) {
        test.attach(entity.id, 'carries-weapons')
      }
      return entity
    }

    // Which body is the human's is a question for the world, not for this file
    // and not for the menu. Exactly one entity carries `player-controlled`;
    // every other body carries `bot-brain`. Naming `player-0` or `you` here
    // would go stale the next time the map is redrawn, and asking the menu who
    // its buyer is would compare the plugin against itself — the assertion
    // below that the menu opens for the right body could then never fail.
    const driven = test.entities.filter(e => e.behaviours?.some(b => b.name === 'player-controlled'))
    const human = driven[0]
    if (!test.ok(human, 'a body in de_dust2 carries player-controlled — that is the human')) return
    test.is(driven.length, 1, 'and exactly one does, so there is no question which')
    carrying(human)
    human.properties.team = 'terrorist'
    standAt(human, terroristSpawn)

    const counterTerrorist = carrying(test.spawn('counter-terrorist', {
      id: 'buyer-counter-terrorist',
      at: [counterTerroristSpawn.x, counterTerroristSpawn.y, counterTerroristSpawn.z],
      collider: PLAYER_BOX,
      properties: { team: 'counter-terrorist' }
    }))

    // ------------------------------------------------------- B, 4, 3 is an AK-47
    // The sequence first, because it is the one thing about this menu a player
    // would notice being wrong. It is also the only part of the test that runs
    // the fixed step, since keys are only read there.
    test.simulate(1 / 60)    // one step, so every start hook has run
    human.money = 5000
    counterTerrorist.money = 16000
    test.is(menu.moneyOf(human), 5000, 'the buyer is holding $5000')

    const announced = []
    const stopListening = buyMenu.bus.on('buy-menu:opened', entity => announced.push(entity.id))

    test.is(menu.buyer()?.id, human.id, 'the menu picks out the same body the world calls player-controlled')

    test.tap('buy')
    test.ok(menu.isOpen, 'B opens the buy menu')
    test.is(menu.entity?.id, human.id, 'for the body a human is driving, and not for a bot')
    // The bus event is how the rest of the game learns the number keys are
    // spoken for. Without it a 3 would pick a rifle and draw a knife.
    test.is(announced, [human.id], 'and it says so on the bus, by entity, exactly once')
    stopListening()

    test.tap('buyMenuDigit4')
    test.is(menu.category, 'Rifles', '4 is the rifle list')

    // What the keyboard raises is kept, because the bot section below compares
    // its own event against it. Two doors that raise the same event with the
    // same shape are one door.
    const throughTheKeyboard = []
    const stopHearing = buyMenu.bus.on('buy-menu:bought', purchase => throughTheKeyboard.push(purchase))
    test.tap('buyMenuDigit3')
    stopHearing()
    test.is(menu.primaryOf(human), 'ak47', '3 is the AK-47 — B, 4, 3, exactly as it always was')
    test.is(menu.moneyOf(human), 2500, 'and it cost $2500')
    test.ok(!menu.isOpen, 'buying closes the menu, the way the original does')
    test.is(throughTheKeyboard.length, 1, 'and one keystroke bought exactly one thing')

    // ------------------------------------------------------- the team restriction
    test.is(menu.buy(human, 'm4a1').refused, 'team',
      'a terrorist cannot buy an M4A1, whatever is in his pocket')
    test.is(menu.buy(counterTerrorist, 'ak47').refused, 'team',
      'and a counter-terrorist cannot buy an AK-47')
    test.ok(menu.buy(counterTerrorist, 'm4a1').ok, 'the M4A1 is exactly what a counter-terrorist does buy')
    test.is(menu.primaryOf(counterTerrorist), 'm4a1', 'and he is carrying it')

    // The same key, the other team, the other rifle: the numbering is the part
    // that has to survive, because it is what people type without looking.
    menu.open(human)
    menu.press(4)
    const terroristRifles = menu.view()
    test.is(terroristRifles.rows[2].id, 'ak47', 'the third rifle a terrorist is offered is the AK-47')
    menu.close()

    menu.open(counterTerrorist)
    menu.press(4)
    test.is(menu.view().rows[2].id, 'm4a1', 'and the third a counter-terrorist is offered is the M4A1')
    menu.close()

    // ------------------------------------------------ one primary, and no refund
    const upgrade = menu.buy(human, 'galil')
    test.ok(upgrade.ok, 'a second primary can be bought')
    test.is(upgrade.dropped, 'ak47', 'and buying it drops the first one')
    test.is(menu.primaryOf(human), 'galil', 'leaving you carrying only the one you just bought')
    test.is(menu.moneyOf(human), 500, 'at full price — dropping a rifle refunds nothing')

    // ---------------------------------------------------------- short of money
    const before = menu.moneyOf(human)
    test.is(menu.buy(human, 'awp').refused, 'money', 'an AWP you cannot afford is refused')
    test.is(menu.moneyOf(human), before, 'a refused purchase costs nothing')
    test.is(menu.primaryOf(human), 'galil', 'and leaves you holding what you already had')

    // Refused, but still on the list. Knowing the AWP is there and that you are
    // short is how you decide whether to save.
    menu.open(human)
    menu.press(4)
    const awp = menu.view().rows.find(row => row.id === 'awp')
    test.ok(awp, 'the AWP is still listed for a terrorist who cannot afford it')
    test.is(awp.affordable, false, 'greyed rather than hidden — what you cannot afford is information')
    menu.close()

    // The number beside it is the number you are charged, proved against the
    // purchase rather than read back out of the same call that drew the row —
    // comparing the row's price with priceOf() would be the menu agreeing with
    // itself, which no amount of the plugin being wrong could disturb.
    human.money = awp.price - 1
    test.is(menu.buy(human, 'awp').refused, 'money', 'a dollar short of the price on the row is refused')
    human.money = awp.price
    test.ok(menu.buy(human, 'awp').ok, 'and the number on the row is exactly enough')
    test.is(menu.moneyOf(human), 0, 'because that is the number it charges, to the dollar')

    // ------------------------------------------------------------ the bot's door
    // A bot never opens a menu. It calls `context.buyMenu.buy(entity, id)` —
    // the same function a keystroke ends up inside — and there is deliberately
    // no second, quieter entrance for it. If one were ever added, the money,
    // the team list and the buy zone would stop applying to half the players in
    // the round and neither half could be balanced against the other.
    //
    // The bot is found the way the human was: by the behaviour it carries.
    const bot = test.entities.find(entity =>
      entity !== human &&
      entity.properties?.team === 'terrorist' &&
      entity.behaviours?.some(attached => attached.name === 'bot-brain'))
    if (test.ok(bot, 'de_dust2 fields terrorist bots beside the human')) {
      carrying(bot)
      standAt(bot, terroristSpawn)
      bot.money = 3000

      const throughTheBot = []
      const stopHearingBot = buyMenu.bus.on('buy-menu:bought', purchase => throughTheBot.push(purchase))
      const botBought = menu.buy(bot, 'ak47')
      stopHearingBot()

      test.ok(botBought.ok, 'a bot buys through context.buyMenu.buy(entity, weaponId)')
      test.is(menu.primaryOf(bot), 'ak47', 'and is carrying what it bought')
      test.is(menu.moneyOf(bot), 500, 'and paid the same $2500 the keyboard paid')
      test.ok(!menu.isOpen, 'without a menu ever having been opened for it')
      test.is(throughTheBot.length, 1, 'the purchase is announced once')
      test.is(throughTheBot[0]?.entity?.id, bot.id, 'against the bot, by entity')
      test.is(Object.keys(throughTheBot[0] ?? {}).sort(), Object.keys(throughTheKeyboard[0] ?? {}).sort(),
        'and in the same shape the keyboard raised, because it is the same purchase')

      // Every rule the human met, the bot meets too — which is the whole claim.
      test.is(menu.buy(bot, 'm4a1').refused, 'team', 'the team list is the same list for a bot')
      test.is(menu.buy(bot, 'awp').refused, 'money', 'and so is being short of money')
      bot.x = terroristSpawn.x + 100
      test.is(menu.buy(bot, 'kevlar').refused, 'buy-zone', 'and so is standing outside a buy zone')
      standAt(bot, terroristSpawn)
      test.state.phase = 'roundEnd'
      test.is(menu.buy(bot, 'kevlar').refused, 'buy-time', 'and so is the round being over')
      test.state.phase = 'freeze'
    }

    // --------------------------------------------------------------- buy time
    // The phase is a plain field in the shared bag — the same one the HUD reads
    // and the match lane publishes — so arranging a round is one assignment.
    test.state.phase = 'roundEnd'
    test.is(menu.buy(counterTerrorist, 'deagle').refused, 'buy-time',
      'nothing can be bought once the round is over')
    test.ok(!menu.open(counterTerrorist).ok, 'and the menu will not open to let you try')
    test.ok(!menu.isOpen, 'so the number keys stay with the game')

    test.state.phase = 'freeze'
    test.ok(menu.buy(counterTerrorist, 'deagle').ok, 'freeze time is buy time, and buying works again')

    // --------------------------------------------------------------- buy zone
    // Out of your own spawn, and nowhere near the other team's either.
    counterTerrorist.x = counterTerroristSpawn.x + 100
    test.is(menu.buy(counterTerrorist, 'kevlar').refused, 'buy-zone',
      'you cannot buy from the middle of the map')
    test.ok(!menu.open(counterTerrorist).ok, 'and the menu will not open out there')
    standAt(counterTerrorist, counterTerroristSpawn)
    test.ok(menu.buy(counterTerrorist, 'kevlar').ok, 'back on your own spawn, you can buy again')

    // The shared bag outlives a level load, so a test that writes to it puts it
    // back — otherwise the next test starts its round in freeze time.
    delete test.state.phase
  }
}
