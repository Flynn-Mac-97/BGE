/**
 * Damage: hitboxes, armour, helmets, death and the ground.
 *
 * The context is reached through the plugin rather than faked, because every
 * claim here is about what the real world does — the real ray decides what a
 * grenade cannot see, the real bus carries the kill, and the real physics is
 * what a body lands on. A fake would agree with all of it today and with none
 * of it in a month.
 *
 * `physics-3d-test` is the level because it is a floor, a wall and nothing else
 * with an opinion. The soldiers below are spawned rather than placed, so this
 * test owns its own world and no level file has to carry a firing range.
 */
import { contextInUse, hitboxAt, armourAfter } from '../plugins/damage.js'

/** The Counter-Strike player box, and where its feet are when it rests on the floor. */
const BODY = [0.81, 1.83, 0.81]
const RESTING = 1.415
const FLOOR = 0.5

export default {
  name: 'a head shot is four times a chest shot, armour wears out, a helmet is worth one bullet, and the ground can kill you',
  level: 'physics-3d-test',

  run(test) {
    const context = contextInUse()
    if (!context) throw new Error('the Damage plugin did not load, so nothing here can be checked')

    /** One soldier: the player box, standing on the floor, able to be hurt. */
    const soldier = (id, at, damageable = {}) => test.spawn('ground', {
      id,
      at,
      collider: { box: BODY },
      properties: { body: 'dynamic', team: 'terrorist' },
      behaviours: { damageable }
    })

    // A firing range at z 8, well clear of the level's own wall and ledges.
    soldier('shot-chest', [0, RESTING, 8])
    soldier('shot-head', [2, RESTING, 8])
    soldier('kevlar', [4, RESTING, 8], { armour: 100 })
    soldier('thin-kevlar', [6, RESTING, 8], { armour: 5 })
    soldier('helmet-weak', [8, RESTING, 8], { armour: 100, helmet: true })
    soldier('helmet-ak', [10, RESTING, 8], { armour: 100, helmet: true })

    // Two drops: one that should hurt and one that should not.
    soldier('fall-hard', [14, RESTING + 4, 8])
    soldier('fall-soft', [16, RESTING + 0.8, 8])

    // Either side of the wall, for the grenade.
    soldier('blast-near', [1.8, RESTING, -3])
    soldier('blast-far', [-1.5, RESTING, -3])
    soldier('blast-hidden', [4.5, RESTING, -3])

    // And again on the other side of it, for the flash.
    soldier('flash-seen', [1.6, RESTING, 2])
    soldier('flash-hidden', [4.8, RESTING, 2])

    const kills = []
    const hurts = []
    const stopWatchingKills = context.bus.on('entity:killed', event => kills.push(event))
    const stopWatchingHurts = context.bus.on('entity:hurt', event => hurts.push(event))
    const killsOf = id => kills.filter(event => event.victim?.id === id).length

    const bag = id => test.entity(id).damageable
    const soundsSince = mark => context.audio.recent(60).slice(mark).map(record => record.file || '')
    const soundMark = () => context.audio.recent(60).length

    // One step before anything is fired, so every soldier's start() has run and
    // the bag it is shot in is the bag it would have in a real round.
    test.simulate(1 / 60)

    try {
      // ------------------------------------------------------- the hitboxes
      // Pure arithmetic on a box, so it is checked as arithmetic. Feet on the
      // floor at 0.5, standing.
      const standing = { y: RESTING, collider: { box: BODY } }
      test.is(hitboxAt(standing, { y: FLOOR + 1.65 }), 'head', '1.65 m up a standing body is the head')
      // Either side of the 1.55 m line rather than on it: a boundary asserted
      // exactly is really an assertion about floating point.
      test.is(hitboxAt(standing, { y: FLOOR + 1.56 }), 'head', 'and 1.56 is the bottom of it')
      test.is(hitboxAt(standing, { y: FLOOR + 1.54 }), 'chest', 'while 1.54 is already the chest')
      test.is(hitboxAt(standing, { y: FLOOR + 1.35 }), 'chest', '1.35 is chest and arms')
      test.is(hitboxAt(standing, { y: FLOOR + 0.9 }), 'stomach', '0.9 is the stomach')
      test.is(hitboxAt(standing, { y: FLOOR + 0.4 }), 'legs', '0.4 is a leg')

      // A crouched body is half as tall, and the head is still the top of it
      // rather than absent.
      const crouched = { y: FLOOR + 0.455, collider: { box: [0.81, 0.91, 0.81] } }
      test.is(hitboxAt(crouched, { y: FLOOR + 0.88 }), 'head', 'the top of a crouched body is still a head')
      test.is(hitboxAt(crouched, { y: FLOOR + 0.2 }), 'legs', 'and the bottom of it is still a leg')

      // ------------------------------------------------------- three to the chest
      // 36 is the AK-47's damage. Three body shots or one head shot is the whole
      // argument for aiming at head height, and it is checked here as arithmetic
      // rather than as a feeling.
      const chest = test.entity('shot-chest')
      const first = context.damage(chest, { amount: 36, hitbox: 'chest' })
      test.is(first.health, 64, 'a 36-damage chest hit takes 36')
      test.is(first.hitbox, 'chest', 'and reports where it landed')
      test.is(hurts.length, 1, 'one hit, one entity:hurt')

      context.damage(chest, { amount: 36, hitbox: 'chest' })
      test.is(bag('shot-chest').health, 28, 'two of them leave 28')
      test.ok(bag('shot-chest').alive, 'and two are not enough')

      const third = context.damage(chest, { amount: 36, hitbox: 'chest' })
      test.ok(third.killed, 'the third one kills')
      test.is(bag('shot-chest').alive, false, 'and the bag says so')
      test.is(killsOf('shot-chest'), 1, 'one death, one entity:killed')

      // Shooting a corpse is allowed and costs it nothing. This is also what
      // stops the rest of a burst from killing the same player five times.
      test.is(context.damage(chest, { amount: 36, hitbox: 'chest' }), null, 'a corpse cannot be hurt again')
      test.is(killsOf('shot-chest'), 1, 'so the kill is not counted twice')

      // -------------------------------------------------------- one to the head
      // Aimed with a point rather than a named hitbox, which is how a bullet
      // arrives: the ray returns where it hit and the body part follows from it.
      const head = test.entity('shot-head')
      const headShot = context.damage(head, {
        amount: 36,
        point: { x: head.x, y: FLOOR + 1.7, z: head.z }
      })
      test.is(headShot.hitbox, 'head', 'a hit 1.7 m up is a head shot')
      test.ok(headShot.killed, 'and 36 to the head is 144, which is one shot')
      test.ok(kills.some(event => event.victim?.id === 'shot-head' && event.headshot),
        'the kill event says it was a head shot')
      // Left on the body, so a kill feed can be built by watching a field rather
      // than by everyone subscribing to everyone.
      test.is(bag('shot-head').lastHitbox, 'head', 'and the body remembers where it was hit')

      // ------------------------------------------------------------- the body
      test.ok(test.exists('shot-chest'), 'a killed entity is kept — a body on the ground is information')
      test.ok(chest.properties.body !== 'solid', 'it stops being solid, so it cannot block a doorway')
      test.is(chest.properties.body, 'trigger', 'it is a trigger: it reports contact and pushes nothing')
      test.near(chest.collider.box[1], 0.35, 0.001, 'and it is lying down rather than standing up')
      test.near(chest.y, FLOOR + 0.175, 0.01, 'on the floor it fell onto, not floating where it died')

      // A body that still stopped bullets at chest height would be a wall that
      // nobody can see is a wall.
      test.is(context.raycast({ x: -4, y: FLOOR + 1.3, z: 8 }, { x: 1, y: 0, z: 0 }, 8,
        { hit: candidate => candidate.id === 'shot-chest' }), null,
        'and a shot through where it was standing now passes through')

      // ------------------------------------------------------------ the armour
      // Half the damage through, half of what was stopped taken out of the plate.
      let mark = soundMark()
      const armoured = context.damage('kevlar', { amount: 36, hitbox: 'chest', armourPenetration: 0.5 })
      test.is(armoured.health, 82, 'kevlar halves a 36-damage body shot')
      test.is(bag('kevlar').armour, 91, 'and the plate is worn down by half of what it stopped')
      test.ok(soundsSince(mark).some(file => file.includes('armor-hit')),
        'armour thuds rather than tearing — you can hear that they bought it')

      // The plate runs out inside one hit: it stops what it can still pay for
      // and the rest lands on flesh. 26 is neither the 18 that full armour would
      // have allowed nor the 36 of no armour at all.
      const running = context.damage('thin-kevlar', { amount: 36, hitbox: 'chest', armourPenetration: 0.5 })
      test.is(running.health, 74, 'five points of armour stop only what five points can buy')
      test.is(bag('thin-kevlar').armour, 0, 'and there is none of it left')
      test.ok(running.amount > 18 && running.amount < 36, 'so the hit landed between armoured and bare')

      context.damage('thin-kevlar', { amount: 36, hitbox: 'chest', armourPenetration: 0.5 })
      test.is(bag('thin-kevlar').health, 38, 'the next one is a bare 36 — "it did nothing" is a true report')

      // The formula on its own, at the two ends nobody usually reaches.
      test.is(armourAfter(36, 0, 0.5).through, 36, 'no armour stops nothing')
      test.is(armourAfter(100, 100, 1).through, 100, 'and armour stops nothing against full penetration')

      // The shooting lane calls a leg a "leg". A name this table did not know
      // would quietly cost the shot its 0.75, so the singular is understood.
      test.is(context.damage('kevlar', { amount: 36, hitbox: 'leg' }).hitbox, 'legs',
        '"leg" is the same body part as "legs", and armour still does not cover it')
      test.is(bag('kevlar').armour, 91, 'a leg shot goes past kevlar entirely')

      // ------------------------------------------------------------ the helmet
      mark = soundMark()
      const weak = context.damage('helmet-weak', {
        amount: 25, hitbox: 'head', weapon: { id: 'glock18', armourPenetration: 0.5 }
      })
      test.ok(!weak.killed, 'a helmet saves a head shot from a weak pistol')
      test.is(weak.health, 50, 'at half of the 100 it would otherwise have been')
      test.is(bag('helmet-weak').helmet, false, 'and the helmet is finished — it is worth one bullet')
      test.ok(soundsSince(mark).some(file => file.includes('hit-helmet')),
        'a helmet pings, which is how the shooter knows to fire again')

      const rifle = context.damage('helmet-ak', {
        amount: 36, hitbox: 'head', weapon: { id: 'ak47', armourPenetration: 0.775 }
      })
      test.ok(rifle.killed, 'and the same helmet is nothing at all against an AK')
      test.is(killsOf('helmet-ak'), 1, 'once, not twice')

      // ------------------------------------------------------------- the ground
      // Falling is the one damage nobody fires, so it is the one that has to
      // happen inside the fixed step rather than from a call.
      test.simulate(1.2)
      test.is(bag('fall-soft').health, 100, 'a 0.8 m drop is free — landing must not be a tax on moving')
      test.ok(bag('fall-soft').alive, 'and nobody dies of it')
      test.note(`a 4 m drop cost ${100 - bag('fall-hard').health} health`)
      test.ok(bag('fall-hard').health < 95, 'a 4 m drop hurts')
      test.ok(bag('fall-hard').health > 40, 'but it is a fall, not an execution')

      // ------------------------------------------------------------ the grenade
      // Radius 4 so the reach is smaller than the distance to the flash pair, and
      // the only thing being measured here is the blast.
      const thrown = { x: 1, y: 1.5, z: -3 }
      context.damage.blast(thrown, { radius: 4, weapon: 'hegrenade' })
      const near = bag('blast-near').health
      const far = bag('blast-far').health
      test.ok(near < 100, 'a grenade hurts what is standing next to it')
      test.ok(far < 100, 'and what is standing further off')
      test.ok(near < far, 'less, the further off it was standing')
      test.is(bag('blast-hidden').health, 100, 'and not at all through a wall')

      // ------------------------------------------------------------ the flash
      const popped = { x: 1, y: 1.5, z: 2 }
      context.damage.flash(popped, { duration: 3 })
      const seen = bag('flash-seen')
      test.is(seen.health, 100, 'a flashbang does no damage')
      test.ok(seen.blindAmount > 0, 'it blinds what could see it')
      test.ok(seen.blindUntil > context.time, 'for a while yet')
      test.is(bag('flash-hidden').blindAmount, 0, 'and nothing that could not see it')

      // It wears off on its own, in the behaviour's own update.
      test.simulate(3.5)
      test.is(bag('flash-seen').blindAmount, 0, 'and then it wears off')
      test.is(bag('flash-seen').blindUntil, 0, 'leaving nothing stale behind')

      // ------------------------------------------------------------- reviving
      const back = context.damage.revive('shot-chest', { health: 100, armour: 50 })
      test.ok(back.alive, 'a revived body is on its feet again')
      test.is(chest.properties.body, 'dynamic', 'and is something you can walk into once more')
      test.is(chest.collider.box[1], BODY[1], 'standing at its full height')
      test.near(chest.y, RESTING, 0.001, 'stood up out of the floor rather than left half inside it')
    } finally {
      stopWatchingKills()
      stopWatchingHurts()
    }
  }
}
