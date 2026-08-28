/**
 * Physics 3D: falling, sliding, stepping, and the ray that every shot fired in
 * the game is one call to.
 *
 * The ray is imported rather than reached through `context.raycast`, because a
 * test is handed `test` and never the context. It is the same function the
 * plugin puts on context, it is pure, and it is given the world's own entities
 * — so what is checked here is what a bullet will do.
 */
import { castRay, canStand } from '../../plugins/builtin/physics-3d.js'

export default {
  name: 'a 3D body falls, slides along a wall, steps up a lip but not a ledge, and the ray reports the face it hit',
  level: 'physics-3d-test',

  run(test) {
    /**
     * Hold a velocity on a body for a while, the way an update hook would.
     *
     * Physics zeroes the axis it blocked, so a body only keeps walking into a
     * wall if something keeps telling it to. It is parked afterwards, so one
     * check cannot wander into the next one's ground.
     */
    const drive = (id, velocityX, velocityZ, seconds) => {
      const body = test.entity(id)
      for (let step = 0; step < Math.round(seconds * 60); step++) {
        body.velocityX = velocityX
        body.velocityZ = velocityZ
        test.simulate(1 / 60)
      }
      body.velocityX = 0
      body.velocityZ = 0
    }

    // ---------------------------------------------------------------- the ray
    // Fired first, while everything is still where the level put it. z is 2 so
    // the shot passes beside the bodies and meets nothing but the wall.
    const wall = castRay(test.entities, { x: 0, y: 1.5, z: 2 }, { x: 1, y: 0, z: 0 }, 10)
    test.ok(wall, 'a ray down the room hits something')
    test.is(wall?.entity.id, 'wall', 'and it is the wall')
    test.near(wall?.distance ?? -1, 2.5, 0.001, 'it hit the near face, 2.5 m away, not the far one')
    test.near(wall?.point.x ?? 0, 2.5, 0.001, 'the point is on that face')
    test.is(wall?.normal, { x: -1, y: 0, z: 0 }, 'the normal faces back down the ray, so a decal lies on the wall')

    const floor = castRay(test.entities, { x: 0, y: 4, z: 2 }, { x: 0, y: -1, z: 0 }, 10)
    test.is(floor?.entity.id, 'floor', 'a shot at the ground hits the floor')
    test.near(floor?.distance ?? -1, 3.5, 0.001, 'at the surface, not the middle of the slab')
    test.is(floor?.normal, { x: 0, y: 1, z: 0 }, 'and the floor normal points up')

    test.is(castRay(test.entities, { x: 0, y: 1.5, z: 2 }, { x: 0, y: 1, z: 0 }, 20), null,
      'a ray fired at nothing returns null')

    // A shooter standing inside its own cover must not be told it hit that
    // cover: the near face is behind the muzzle.
    test.is(castRay(test.entities, { x: 3, y: 1.5, z: 0 }, { x: 1, y: 0, z: 0 }, 10), null,
      'a ray starting inside a box reports no hit on that box')

    // Down the middle, where a body is standing in front of the wall.
    const nearest = castRay(test.entities, { x: 0, y: 1.5, z: 0 }, { x: 1, y: 0, z: 0 }, 10)
    test.is(nearest?.entity.id, 'slider', 'the nearest thing on the line wins')
    test.is(castRay(test.entities, { x: 0, y: 1.5, z: 0 }, { x: 1, y: 0, z: 0 }, 10,
      { ignore: ['slider'] })?.entity.id, 'wall', 'ignore skips it — this is how a shooter skips itself')
    test.is(castRay(test.entities, { x: 0, y: 1.5, z: 0 }, { x: 1, y: 0, z: 0 }, 10,
      { hit: entity => entity.id === 'wall' })?.entity.id, 'wall', 'and hit() narrows what counts as a candidate')

    // A shooter has one entity to skip and reaches for the shape that says so.
    // `(options.ignore || []).map(...)` threw on both of these — from inside a
    // bullet, on the fixed step, which is the worst place in the engine to throw.
    test.is(castRay(test.entities, { x: 0, y: 1.5, z: 0 }, { x: 1, y: 0, z: 0 }, 10,
      { ignore: 'slider' })?.entity.id, 'wall', 'ignore takes a bare id as well as a list')
    test.is(castRay(test.entities, { x: 0, y: 1.5, z: 0 }, { x: 1, y: 0, z: 0 }, 10,
      { ignore: test.entity('slider') })?.entity.id, 'wall', 'and a single entity')

    // ------------------------------------------------- a ray that is not a ray
    // A bad coordinate used to be rewritten to 0, which moved the muzzle to the
    // world origin and returned a confident hit on something the shooter was
    // never pointing at. There is no safe default for where a shot came from.
    test.is(castRay(test.entities, { x: 0, y: Number.NaN, z: 2 }, { x: 1, y: 0, z: 0 }, 10), null,
      'a ray with a non-finite origin is refused, not fired from the world origin')
    test.is(castRay(test.entities, [0, 1.5], { x: 1, y: 0, z: 0 }, 10), null,
      'and so is an origin with a coordinate missing')
    test.is(castRay(test.entities, { x: 0, y: 1.5, z: 2 }, { x: 'east', y: 0, z: 0 }, 10), null,
      'and a direction that is not numbers')

    // ------------------------------------------------------------ canStand
    // Grown about the feet, the way a player stands up. A height it cannot make
    // sense of has to answer "no room": refusing to stand looks stuck, and
    // standing up on a NaN puts the player's head inside a ceiling.
    const room = { entities: test.entities }
    test.ok(canStand(room, test.entity('faller'), 1.83), 'a body in the open has room to stand its own height')
    test.ok(!canStand(room, test.entity('faller'), undefined), 'a height of undefined is refused rather than reported as room')
    test.ok(!canStand(room, test.entity('faller'), '1.83'), 'and a height that arrived as a string')
    test.ok(!canStand(room, test.entity('faller'), 0), 'and a height of nothing at all')

    // ------------------------------------------------------------- falling
    const faller = test.entity('faller')
    test.simulate(1.5)
    // The floor surface is y 0.5 and the body is 1.83 tall, so 0.5 + 0.915.
    test.near(faller.y, 1.415, 0.001, 'landed on the floor surface, not inside it')
    test.ok(faller.grounded, 'and the ground contact was reported')

    const settled = faller.y
    test.simulate(1)
    test.near(faller.y, settled, 0.0001, 'resting means resting')

    // ------------------------------------------------------------- sliding
    const slider = test.entity('slider')
    drive('slider', 4, 2, 1)
    test.near(slider.x, 2.095, 0.005, 'stopped against the near face of the wall')
    test.near(slider.z, 2, 0.02, 'and kept every bit of its speed along the wall')
    test.ok(slider.grounded, 'still standing on the floor while it did')

    // ------------------------------------------------------------- stepping
    const stepper = test.entity('stepper')
    drive('stepper', -3, 0, 0.5)
    // The lip is 0.3 m, inside the 0.46 m step height, so it is walked over.
    test.near(stepper.y, 1.715, 0.001, 'stepped up onto the 0.3 m ledge')
    test.near(stepper.x, -2.5, 0.02, 'without the lip costing it any ground')

    const climber = test.entity('climber')
    drive('climber', -3, 0, 1)
    // 0.9 m is over the step height, and a body that could walk up it could
    // walk up a wall.
    test.near(climber.x, -6.595, 0.005, 'stopped dead against the 0.9 m ledge')
    test.near(climber.y, 1.415, 0.001, 'and did not climb it')

    // ------------------------------------------------------- a NaN velocity
    /**
     * One `0 / 0` in a movement behaviour used to take a body out of the
     * simulation for the rest of the session, with nothing in the log.
     *
     * The sub-step count is `Math.max(1, Math.ceil(travel / smallest))`, and
     * `Math.max(1, NaN)` is NaN rather than 1 — the loop then runs zero times
     * and the body simply stops. It looks exactly like a bug in the behaviour
     * that set the velocity, which is where the search goes first and the
     * several thousand tokens go with it.
     */
    const stuck = test.entity('faller')
    const wasAt = stuck.x
    stuck.velocityX = 0 / 0
    test.simulate(1 / 60)
    test.ok(Number.isFinite(stuck.velocityX), 'a NaN velocity is caught and zeroed rather than left on the body')
    test.ok(Number.isFinite(stuck.x) && Number.isFinite(stuck.y), 'and the position it would have poisoned is still real')

    stuck.velocityX = 3
    test.simulate(0.2)
    test.ok(stuck.x > wasAt + 0.4, 'and the body is still being simulated — it moves on the very next push')

    // Gravity is a property, so it is whatever a level file or a command last
    // wrote there. A string there is the same NaN by another route.
    stuck.velocityX = 0
    stuck.properties.gravity = 'down'
    const height = stuck.y
    test.simulate(1 / 60)
    test.ok(Number.isFinite(stuck.y), 'a gravity that is not a number falls back rather than poisoning the position')
    test.near(stuck.y, height, 0.001, 'and the body is still resting on the floor rather than gone')
    stuck.properties.gravity = undefined
  }
}
