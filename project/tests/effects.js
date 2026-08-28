/**
 * Effects: the particles a shot throws up and the mark it leaves behind.
 *
 * Two things are being checked at once here, and they need reaching in two
 * different ways.
 *
 * The *running* world's particles and decals are the module-level field and
 * wall the plugins put on `context` — imported directly, the way the Physics 3D
 * test imports `castRay`, because a test is handed `test` and never the
 * context. Stepping the fixed clock with `test.simulate` then exercises the
 * real systems: if the plugin's fixed step were not registered, nothing here
 * would ever age.
 *
 * The *determinism* check needs a random stream it can rewind, and a test
 * cannot re-seed the world it is running in. So it builds a second field and
 * binds it to a loop of its own — the engine's own loop, not a copy of it, so
 * what is being proved is that the same stream gives the same smoke.
 *
 * The level is `level1` on purpose: nothing below reads a single entity out of
 * it, and a test that depends on no level geometry cannot be broken by somebody
 * else moving a wall.
 */
import { makeLoop } from '../../engine/loop.js'
import { castRay } from '../../plugins/builtin/physics-3d.js'
import { particles, makeParticleField } from '../../plugins/builtin/particles.js'
import { decals } from '../../plugins/builtin/decals.js'

export default {
  name: 'a burst is deterministic and dies on time, a decal lies on the surface it hit, and smoke blocks the line through it',
  level: 'level1',

  run(test) {
    // ------------------------------------------------------- the plugins are on
    test.ok(particles.bound, 'the running world gave the particle field its random stream')
    test.is(decals.cap, 300, 'the decal budget is the fixed 300 the file declares')

    // --------------------------------------------------- a burst, and its life
    particles.clear()
    const record = particles.burst({
      at: { x: 0, y: 1, z: 0 }, count: 12, speed: 0, life: 0.5, size: 0.05, colour: '#cdba90'
    })
    test.is(particles.count, 12, 'a burst of twelve makes twelve particles')
    test.is(record?.count, 12, 'and records that it did, so a headless run can be asked')
    test.is(particles.recent(1).length, 1, 'the record is kept whether or not anyone saw it')

    test.simulate(0.4)
    test.is(particles.count, 12, 'still alive a tenth of a second short of their life')
    test.simulate(0.2)
    test.is(particles.count, 0, 'and gone once it runs out — the fixed step is ageing them')

    // ------------------------------------------------ the same seed, twice over
    // A field of its own, on a loop of its own, because the world running this
    // test has no re-seed and comparing two draws from one stream proves nothing.
    const loop = makeLoop({ onFixed() {}, onFrame() {} })
    const field = makeParticleField()
    field.bind(loop.random, () => 0)

    const smokeFrom = seed => {
      loop.random.reset(seed)
      field.clear()
      field.burst({
        at: { x: 0, y: 2, z: 0 }, count: 40, speed: [1, 4], life: 2,
        size: [0.1, 0.3], gravity: -9, drag: 1.2
      })
      for (let step = 0; step < 30; step++) field.step(1 / 60)
      return field.positions()
    }

    const first = smokeFrom(7)
    const second = smokeFrom(7)
    test.is(first.length, 40, 'forty particles came out of the burst')
    test.is(first, second, 'the same seed put every one of them in the same place')
    test.ok(JSON.stringify(smokeFrom(9)) !== JSON.stringify(first),
      'and a different seed does not — so this is the stream, not a constant')

    // ------------------------------------------------------------- the trail
    // Stepped with a world of its own, because `byId` is the whole of the world
    // a trail reads: it is how a trail on a spent grenade stops itself.
    const ghost = { id: 'ghost', x: 5, y: 1, z: 0 }
    const holding = { byId: () => ghost }
    const gone = { byId: () => undefined }

    field.clear()
    field.trail(ghost, { rate: 60, life: 5, speed: 0 })
    for (let step = 0; step < 30; step++) field.step(1 / 60, holding)
    test.is(field.count, 30, 'a trail at sixty a second emits thirty in half a second')

    field.step(1 / 60, gone)
    field.step(1 / 60, gone)
    test.is(field.count, 30, 'and stops itself the moment the entity it followed is gone')

    // -------------------------------------------- a decal, on the face it hit
    // The wall is a literal rather than a level entity: castRay takes an entity
    // list, so the surface under test is stated here in full and cannot be
    // moved out from under this file.
    const wall = { id: 'test-wall', type: 'brush', x: 3, y: 1.5, z: 0, collider: { box: [0.5, 3, 6] }, properties: { body: 'solid' } }
    const hit = castRay([wall], { x: 0, y: 1.5, z: 0 }, { x: 1, y: 0, z: 0 }, 10)
    test.ok(hit, 'the ray reached the wall')
    test.is(hit?.normal, { x: -1, y: 0, z: 0 }, 'and reported the face it came in through')

    decals.clear()
    const hole = decals.place({
      at: hit.point, normal: hit.normal, size: 0.09,
      texture: 'counter-strike/decal-bullet-hole.png', tint: '#c9b489'
    })
    test.near(hole?.x ?? 0, 2.749, 1e-6, 'the hole sits a millimetre out of the wall, not in it')
    test.near(hole?.y ?? 0, 1.5, 1e-9, 'at the height the ray hit')
    test.near(hole?.point.x ?? 0, 2.75, 1e-9, 'and it remembers where the ray actually landed')
    test.is(decals.count, 1, 'one shot, one mark')

    // --------------------------------------------------- the budget recycles
    const before = decals.state.placed
    for (let shot = 0; shot < 400; shot++) {
      decals.place({ at: { x: shot * 0.1, y: 0, z: 0 }, normal: { x: 0, y: 1, z: 0 }, size: 0.1 })
    }
    const wall400 = decals.all
    test.is(decals.count, 300, 'four hundred shots leave three hundred marks — the cap holds')
    test.is(wall400[299].id, before + 400, 'the newest is there')
    test.is(wall400[0].id, before + 101, 'and it is the oldest hundred that went, not the newest')
    test.ok(decals.state.recycled >= 100, 'they were recycled rather than allowed to grow')

    // ------------------------------------------------------ a decal with a life
    decals.clear()
    decals.place({ at: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 1, z: 0 }, size: 0.5, life: 0.5 })
    test.is(decals.count, 1, 'a blood splatter is placed')
    test.simulate(0.6)
    test.is(decals.count, 0, 'and wipes itself when its life runs out')

    // ------------------------------------------------------------- the smoke
    particles.clear()
    const cloud = particles.effect('smoke', { at: { x: 0, y: 1, z: 0 } })
    test.is(cloud?.blocks, 4, 'a smoke grenade declares the four metres of sight it takes away')
    test.ok(particles.count > 500, 'and it is a real cloud of particles, not a token one')

    test.ok(!particles.blocked({ x: -6, y: 1, z: 0 }, { x: 6, y: 1, z: 0 }),
      'the moment it lands it hides nobody — the cloud opens out')
    test.simulate(2)
    test.ok(particles.blocked({ x: -6, y: 1, z: 0 }, { x: 6, y: 1, z: 0 }),
      'once it has opened, a sightline straight through it is blocked')
    test.ok(!particles.blocked({ x: -6, y: 1, z: 5 }, { x: 6, y: 1, z: 5 }),
      'and one five metres to the side of it is not')
    test.ok(particles.blocked({ x: 0, y: 1, z: 0 }, { x: 6, y: 1, z: 0 }),
      'someone standing inside it cannot see out either')

    particles.clear()
    test.ok(!particles.blocked({ x: -6, y: 1, z: 0 }, { x: 6, y: 1, z: 0 }),
      'and when the cloud is gone the line is clear again')
  }
}
