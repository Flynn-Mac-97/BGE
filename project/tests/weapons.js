/**
 * The weapons: the trigger, the magazine, the spray pattern and the armour.
 *
 * A test is handed the `test` object and nothing else, so it cannot reach
 * `context.weapons` the way a plugin can — and the whole subject here is what
 * pulling a trigger does. The Weapons plugin exports `runningWeapons()` for
 * exactly this: a plugin module is a singleton in node and in the browser alike,
 * so importing it here reaches the very table and the very trigger the live
 * world is using, rather than a second copy that could quietly differ.
 *
 * `physics-3d-test` is the level because it is the smallest world with a floor
 * to stand on and room to shoot across. Everything shot at is spawned here, so
 * the numbers below are the test's own and not a map's.
 */
import { runningWeapons } from '../plugins/weapons.js'
import { runningCamera } from '../../plugins/builtin/camera.js'

/** Where the shooter and the target stand. Ten metres apart, down -Z. */
const RANGE = 10

/**
 * The pitch that puts a shot in the chest of a body ten metres away. The eye is
 * 1.62 m above the feet and the chest is seven tenths of the way up a 1.83 m
 * body, so the shot has to fall 0.339 m over the ten metres.
 */
const CHEST_PITCH = -Math.atan((1.62 - 0.7 * 1.83) / RANGE)

export default {
  name: 'firing spends a round at the right rate, the spray pattern walks and resets, and armour behaves',
  level: 'physics-3d-test',

  run(test) {
    const live = runningWeapons()
    if (!live) return test.ok(false, 'the Weapons plugin is loaded')
    const { context, weapons } = live

    // Both bodies are the Counter-Strike player box, and both rest on the
    // floor's surface at y 0.5, so the centre sits at 0.5 + 0.915.
    const body = { box: [0.81, 1.83, 0.81] }
    const shooter = test.spawn('ground', {
      id: 'shooter', at: [0, 1.415, 0], collider: body,
      properties: { body: 'dynamic', team: 'terrorist' }
    })
    test.spawn('ground', {
      id: 'target', at: [0, 1.415, -RANGE], collider: body,
      properties: { body: 'dynamic', team: 'counter-terrorist' }
    })
    // Attached rather than declared in a level file, because what a player
    // carries belongs to the game's own levels and this one is the physics
    // sandbox. `start` runs on the first simulate below, which is what fits the
    // shooter out with the two weapons named here.
    test.attach('shooter', 'carries-weapons', { primary: 'ak47', secondary: 'usp' })

    // Long enough for the AK's 0.6 s deploy to finish.
    test.simulate(1)
    const bag = shooter.carriesWeapons
    test.ok(bag, 'the bag is reachable as entity.carriesWeapons, which is what every other lane reads')
    test.is(bag.current, 'ak47', 'the best weapon given is the one deployed')
    test.is(bag.ammo, 30, 'with the magazine the table says')
    test.is(bag.reserve, 90, 'and the reserve the table says')
    test.near(bag.moveSpeedFactor, 0.884, 1e-9, 'holding an AK slows the carrier to 88% of a knife')

    // Pointed away from the target until the aiming section below, so that the
    // rate and magazine checks are about the trigger and nothing else — and so
    // the damage lane is not asked forty times over to hurt a bare box.
    shooter.aimYaw = Math.PI / 2

    // ------------------------------------------------- spending, and the rate
    test.ok(weapons.fire(shooter), 'the trigger fires')
    test.is(bag.ammo, 29, 'a shot spends exactly one round')

    test.is(weapons.fire(shooter), false, 'and the next pull is refused straight away')
    test.simulate(0.05)
    test.is(weapons.fire(shooter), false, 'still refused half a fire interval later')
    test.is(bag.ammo, 29, 'a refused shot spends nothing')

    // 600 rounds a minute is one every tenth of a second.
    test.simulate(0.07)
    test.ok(weapons.fire(shooter), 'a tenth of a second after the last one, it fires')
    test.is(bag.ammo, 28, 'and that one spent a round too')

    // ------------------------------------------------ emptying, and reloading
    for (let pull = 0; pull < 40; pull++) {
      weapons.fire(shooter)
      test.simulate(0.12)
    }
    test.is(bag.ammo, 0, 'the magazine empties and then refuses to fire')
    test.is(bag.reserve, 90, 'and nothing comes out of the reserve until a reload')

    test.ok(weapons.reload(shooter), 'an empty gun reloads')
    test.is(weapons.fire(shooter), false, 'and cannot fire while it is reloading')
    test.simulate(2.6)
    test.is(bag.ammo, 30, 'a reload fills the magazine to exactly what the table says')
    test.is(bag.reserve, 60, 'taking exactly that much out of the reserve')
    test.is(weapons.reload(shooter), false, 'and a full magazine refuses to reload again')

    // A magazine belongs to the weapon, not to the player: switching away and
    // back must neither hand out a fresh thirty nor lose the rounds left.
    weapons.fire(shooter)
    test.is(bag.ammo, 29, 'one round gone')
    weapons.select(shooter, 3)
    test.simulate(0.6)
    test.is(bag.current, 'knife', 'slot three is the knife')
    test.near(bag.moveSpeedFactor, 1, 1e-9, 'and a knife lets its carrier run at full speed')
    weapons.select(shooter, 1)
    test.simulate(0.7)
    test.is(bag.ammo, 29, 'the rifle came back out with the magazine it went away with')

    // ------------------------------------------------------ the spray pattern
    const camera = runningCamera()?.camera
    if (!camera) return test.ok(false, 'the Game Camera plugin is loaded')
    context.view.mode = 'first-person'
    // Still pointed away from the target: what is measured here is the pitch the
    // pattern puts on the aim, and a body in the way would only add noise.
    context.view.yaw = Math.PI / 2
    context.view.pitch = 0
    camera.follow('shooter')
    // Let the last shot's kick decay off the view completely, so what is
    // measured below is the pattern and not the tail of something earlier.
    test.simulate(1.2)

    const walked = []
    for (let shot = 0; shot < 9; shot++) {
      weapons.fire(shooter)
      // Read after the shot: the bullet leaves along the old aim and the kick
      // lands behind it, which is why the first bullet of a burst is accurate.
      walked.push(camera.aim().pitch)
      test.simulate(0.1)
    }
    test.ok(walked[1] > walked[0], 'the second shot of an AK spray is aiming higher than the first')
    test.ok(walked[3] > walked[1], 'and the fourth higher again')
    test.ok(walked[8] > walked[0] + 0.1, 'nine shots walk the aim more than five degrees up the screen')

    // The shape, read off the table itself so no jitter is in the way. Nine
    // shots almost straight up, a hard sweep left, then back across to the
    // right — the pattern people can draw from memory.
    const pattern = weapons.get('ak47').pattern
    test.ok(Math.abs(pattern[4].yaw) < 1, 'the climb goes up, not sideways')
    test.ok(pattern[13].yaw > 3, 'then the pattern sweeps hard left')
    test.ok(pattern[24].yaw < -3, 'and comes back across to the right')

    // Off the trigger for a third of a second and it starts again.
    test.simulate(0.5)
    test.is(bag.shotsFired, 0, 'a pause lets the pattern go cold')
    weapons.fire(shooter)
    test.ok(camera.aim().pitch < walked[1],
      'so the next shot kicks like a first shot rather than carrying on up')

    // ------------------------------------------ the shot, and what it reaches
    // The camera is let go of, so the shots below are aimed the way a bot aims:
    // two plain fields on the entity, the same maths, no private path in.
    camera.follow(null)
    shooter.aimYaw = 0
    shooter.aimPitch = CHEST_PITCH

    const blows = []
    const hadDamage = context.damage
    context.damage = (target, blow) => blows.push({ target: target.id, ...blow })

    try {
      test.simulate(0.5)
      test.ok(weapons.fire(shooter), 'a bot aiming with its own fields fires the same trigger')
      test.is(blows.length, 1, 'and the shot reached something that can be hurt')
      test.is(blows[0]?.target, 'target', 'the body ten metres away')
      test.is(blows[0]?.weapon, 'ak47', 'the weapon is named in the blow')
      test.is(blows[0]?.hitbox, 'chest', 'and so is the hitbox it struck')
      // 36 at the muzzle, falling off as 0.98 for every 12.7 m travelled.
      test.near(blows[0]?.amount ?? 0, 36 * Math.pow(0.98, RANGE / 12.7), 0.4,
        'the damage handed over is the base damage after the distance took its share')

      const clean = blows[0].amount

      // -------------------------------------------------------- the wallbang
      // A 0.2 m panel, well inside the AK's 0.35 m of penetration. de_dust2 has
      // famous spots for this and a rifle that cannot do it is not a rifle.
      test.spawn('ground', { id: 'thin-wall', at: [0, 1.6, -5], collider: { box: [4, 3, 0.2] } })
      test.simulate(0.5)
      weapons.fire(shooter)
      test.is(blows.length, 2, 'the bullet came out the far side of a thin wall')
      test.ok(blows[1]?.amount < clean * 0.7, 'and arrived with much less of its damage')
      test.ok(blows[1]?.amount > clean * 0.2, 'but with enough of it to still be worth doing')

      test.destroy('thin-wall')
      test.spawn('ground', { id: 'thick-wall', at: [0, 1.6, -5], collider: { box: [4, 3, 1.5] } })
      test.simulate(0.5)
      weapons.fire(shooter)
      test.is(blows.length, 2, 'a metre and a half of wall stops the same bullet dead')
      test.destroy('thick-wall')
    } finally {
      context.damage = hadDamage
    }

    // ------------------------------------------------- armour, and the helmet
    // Pure arithmetic, so no shot has to be arranged to check it. This is the
    // one function the damage lane is meant to call rather than reimplement.
    const bare = weapons.damageTo('ak47', { hitbox: 'chest' })
    test.near(bare.health, 36, 1e-9, 'an AK does its 36 to an unarmoured chest')

    const vested = weapons.damageTo('ak47', { hitbox: 'chest', armour: 100 })
    test.near(vested.health, 27.9, 1e-9, 'a vest keeps out what the AK cannot penetrate — 0.775 of 36 gets through')
    test.near(vested.armour, 4.05, 1e-9, 'and the vest itself loses half of what it stopped')

    const m4Vested = weapons.damageTo('m4a1', { hitbox: 'chest', armour: 100 })
    test.near(m4Vested.health, 23.1, 1e-9, 'the M4 loses more to the same vest, because it penetrates less')
    test.ok(vested.health > m4Vested.health, 'which is the AK against the M4 in a single number')

    test.near(weapons.damageTo('ak47', { hitbox: 'leg', armour: 100 }).health, 27, 1e-9,
      'a vest does not cover the legs, so a leg shot is armour-blind')

    const akHead = weapons.damageTo('ak47', { hitbox: 'head', armour: 100, helmet: true })
    test.ok(akHead.health >= 100, 'an AK takes a helmeted head off in one shot')
    test.near(akHead.health, 111.6, 1e-9, '111.6 of it, with eleven to spare')

    const m4Head = weapons.damageTo('m4a1', { hitbox: 'head', armour: 100, helmet: true })
    test.ok(m4Head.health < 100, 'and the same shot from an M4 does not')
    test.near(m4Head.health, 92.4, 1e-9, '92.4 — eight short, which is the whole reason a helmet is bought')
    test.ok(weapons.damageTo('m4a1', { hitbox: 'head' }).health >= 100,
      'against a bare head the M4 kills in one as well')

    test.ok(weapons.damageTo('awp', { hitbox: 'chest', armour: 100 }).health >= 100,
      'an AWP kills through a vest with a body shot')
    test.ok(weapons.damageTo('awp', { hitbox: 'leg', armour: 100 }).health < 100,
      'but not with a leg shot, which is the only mercy it offers')

    test.ok(weapons.falloff('glock18', 25) < weapons.falloff('ak47', 25),
      'a Glock loses far more over 25 m than an AK does')

    // ---------------------------------------------------- buying and dropping
    test.ok(weapons.give(shooter, 'awp'), 'an AWP can be bought over the rifle in the primary slot')
    test.is(bag.primary, 'awp', 'and takes the slot')
    test.is(bag.current, 'awp', 'and is the one deployed')
    test.near(bag.moveSpeedFactor, 0.84, 1e-9, 'an AWP walks noticeably slower than a knife, which is the trade')

    test.simulate(1.1)
    test.ok(weapons.drop(shooter), 'the AWP can be dropped')
    test.is(bag.primary, null, 'leaving the primary slot empty')
    test.is(bag.current, 'usp', 'and the pistol out')

    weapons.select(shooter, 3)
    test.simulate(0.5)
    test.is(weapons.drop(shooter), false, 'the knife cannot be dropped — it is the last resort and the run speed')
  }
}
