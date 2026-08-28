/**
 * How it feels to move: the numbers behind the feel, pinned down.
 *
 * Everything else in the game can be right and if this is wrong it is a
 * different game, so each check here is a thing a Counter-Strike player would
 * notice within ten seconds of holding a key — a top speed that does not creep,
 * a stop that is crisp, a counter-strafe that beats letting go, a jump that
 * clears what it should, air control that pays for turning and nothing for
 * holding, and a duck you cannot stand up out of.
 *
 * It runs in `physics-3d-test`, which is a forty metre floor with a wall and
 * two ledges huddled around the origin. Everything below happens out at z 12
 * and z 15, where that level put nothing, and brings its own furniture.
 *
 * The bodies are driven by writing the wish fields directly, because that is
 * exactly what a bot does and it keeps the movement model under test rather
 * than the keyboard. The last section drives one through the real bound keys
 * instead, which is the only part that is about `player-controlled`.
 */
import { runningCamera } from '../../plugins/builtin/camera.js'

const STEP = 1 / 60

/** The floor's surface, and where a 1.83 m body's centre rests on it. */
const FLOOR = 0.5
const STANDING_HEIGHT = 1.83
const REST_HEIGHT = FLOOR + STANDING_HEIGHT / 2

/**
 * A ducked Counter-Strike player is 0.915 m — half of 1.83 — so a gap has to be
 * a little over 0.9 m for one to fit under it at all. 0.95 leaves 35 mm, which
 * a crouched body clears and a standing one misses by nearly a metre.
 */
const GAP = 0.95

export default {
  name: 'the Counter-Strike move: top speed, a crisp stop, counter-strafing, the jump, air control, and a duck you cannot stand up out of',
  level: 'physics-3d-test',

  run(test) {
    const live = runningCamera()
    if (!live) return test.ok(false, 'the Game Camera plugin is loaded, so there is an aim to walk relative to')
    const { context } = live
    const view = context.view
    const wasYaw = view.yaw

    // Everything is spawned before the first simulate, because the test runner
    // runs `start` on the whole world the first time the clock moves and an
    // entity that arrives later never gets one.
    const body = (id, x, z, behaviours) => test.spawn('ground', {
      id,
      at: [x, REST_HEIGHT, z],
      collider: { box: [0.81, STANDING_HEIGHT, 0.81] },
      properties: { body: 'dynamic' },
      behaviours
    })

    const runner = body('move-runner', 12, 15, ['counter-strike-movement'])
    const ducker = body('move-ducker', -16, 12, ['counter-strike-movement'])
    // Input first, movement second: hooks run in the order they are written, so
    // this is the ordering that makes a key press land on the step it happened.
    const human = body('move-human', -4, 15, ['player-controlled', 'counter-strike-movement'])

    // A lintel with its underside exactly GAP above the floor, out where
    // nothing else lives. Four metres deep, so a body walks a long way in
    // before it is under the middle of it.
    test.spawn('ground', {
      id: 'move-lintel',
      at: [-12, FLOOR + GAP + 0.5, 12],
      collider: { box: [4, 1, 4] }
    })

    const terrorist = test.spawn('terrorist', { id: 'move-terrorist', at: [16, REST_HEIGHT, 15] })
    const counterTerrorist = test.spawn('counter-terrorist', { id: 'move-counter-terrorist', at: [16, REST_HEIGHT, 18] })

    /**
     * Hold a wish on a body for a while, exactly as player-controlled or a bot
     * would write it — reasserted every step, because nothing else clears it
     * and a test that set it once would be testing something else.
     */
    const drive = (entity, wish, seconds) => {
      const steps = Math.round(seconds * 60)
      for (let step = 0; step < steps; step++) {
        Object.assign(entity, wish)
        test.simulate(STEP)
      }
    }

    const rest = entity => Object.assign(entity, {
      wishForward: 0, wishStrafe: 0, wishJump: false, wishCrouch: false, wishWalk: false
    })

    /** Put a body back on its mark with nothing left over from the last check. */
    const park = (entity, x, z) => {
      rest(entity)
      entity.x = x
      entity.z = z
      entity.y = REST_HEIGHT
      entity.velocityX = 0
      entity.velocityY = 0
      entity.velocityZ = 0
      drive(entity, {}, 0.2)
    }

    /** Jump once, then run out the flight and report the highest point of it. */
    const hop = entity => {
      entity.wishJump = true
      test.simulate(STEP)
      entity.wishJump = false
      let apex = entity.y
      for (let step = 0; step < 300; step++) {
        test.simulate(STEP)
        apex = Math.max(apex, entity.y)
        if (step > 2 && entity.grounded) break
      }
      return apex
    }

    try {
      // Yaw 0 faces -Z, so "forward" is down the empty lane at x 12.
      runner.aimYaw = 0
      ducker.aimYaw = 0
      terrorist.aimYaw = 0
      view.yaw = 0

      // ------------------------------------------------------------ top speed
      drive(runner, { wishForward: 1 }, 1.5)
      test.near(runner.moveSpeed, 6.35, 0.001, 'holding forward settles on the 6.35 m/s ground maximum')
      test.ok(runner.moveSpeed <= 6.35 + 1e-9, 'and never gets past it, however long it is held')
      test.near(runner.velocityX, 0, 1e-9, 'forward means where the body is aiming, and at yaw 0 that is -Z')
      test.near(runner.velocityZ, -6.35, 0.001, 'down the negative Z axis')

      drive(runner, { wishForward: 1, wishStrafe: 1 }, 1.5)
      test.near(runner.moveSpeed, 6.35, 0.001, 'forward and strafe together is not faster than either — the diagonal is normalised')

      drive(runner, { wishForward: 1, wishStrafe: 0, wishWalk: true }, 2)
      test.near(runner.moveSpeed, 3.3, 0.01, 'walking holds 3.3 m/s, which is the speed the sound lane reads to keep it silent')

      // ---------------------------------------------------------- letting go
      park(runner, 12, 15)
      drive(runner, { wishForward: 1 }, 1.5)
      const releasedAt = runner.z
      drive(runner, { wishForward: 0 }, 1)
      const coasted = releasedAt - runner.z
      test.near(coasted, 1.29, 0.05, 'releasing forward at full speed coasts about 1.3 m and stops')
      test.is(runner.moveSpeed, 0, 'stopped means stopped, not drifting')

      // -------------------------------------------------------- counter-strafe
      // The core skill: tap the opposite key and the body stops dead, which is
      // what makes shooting the instant after moving possible at all.
      park(runner, 12, 15)
      drive(runner, { wishForward: 1 }, 1.5)
      const counteredAt = runner.z
      let counterSteps = 0
      while (runner.velocityZ < -0.01 && counterSteps < 300) {
        runner.wishForward = -1
        test.simulate(STEP)
        counterSteps++
      }
      const counterDistance = counteredAt - runner.z
      test.note(`counter-strafing stopped in ${round(counterDistance)} m and ${counterSteps} steps; letting go took ${round(coasted)} m`)
      test.near(counterDistance, 0.43, 0.05, 'counter-strafing kills full speed in well under half a metre')
      test.ok(counterDistance < coasted / 2, 'which is less than half the ground letting go costs')
      test.ok(counterSteps < 12, 'and it takes a fifth of a second, not half of one')

      // ---------------------------------------------------------------- jump
      park(runner, 12, 15)
      const stoodAt = runner.y
      const apex = hop(runner)
      test.near(apex - stoodAt, 1.085, 0.03, 'a jump clears 1.08 m, which is Counter-Strike\'s 45 units')
      test.near(runner.y, stoodAt, 0.001, 'and lands back on the floor it left')
      test.ok(runner.grounded === true, 'standing on it again')

      park(runner, 12, 15)
      drive(runner, { wishJump: true }, 1.5)
      test.near(runner.y, REST_HEIGHT, 0.001, 'holding jump hops once and then stays down — you have to let go to hop again')

      // ------------------------------------------------------- air, in a line
      park(runner, 12, 15)
      drive(runner, { wishForward: 1 }, 1.5)
      const tookOffAt = runner.moveSpeed
      runner.wishJump = true
      test.simulate(STEP)
      runner.wishJump = false
      let straightFastest = 0
      for (let step = 0; step < 300; step++) {
        runner.wishForward = 1
        test.simulate(STEP)
        straightFastest = Math.max(straightFastest, runner.moveSpeed)
        if (step > 2 && runner.grounded) break
      }
      test.near(straightFastest, tookOffAt, 1e-9,
        'holding forward in a straight line through the air adds nothing — your speed along the wish is already far past the 0.76 m/s cap')
      test.ok(straightFastest <= 6.35 + 1e-9, 'so a jump can never be a way past the ground maximum')

      // -------------------------------------------------------- air, turning
      // The same clamp, paid the other way: strafe right and turn right, so the
      // wish direction stays across the velocity where the dot product stays
      // near zero, and the clamp hands over another 0.76 m/s every step.
      park(runner, 12, 15)
      runner.aimYaw = 0
      drive(runner, { wishForward: 1 }, 1.5)
      const strafedFrom = runner.moveSpeed
      runner.wishJump = true
      test.simulate(STEP)
      runner.wishJump = false
      for (let step = 0; step < 300; step++) {
        runner.wishForward = 0
        runner.wishStrafe = 1
        runner.aimYaw -= 0.09
        test.simulate(STEP)
        if (step > 2 && runner.grounded) break
      }
      test.note(`air-strafing took ${round(strafedFrom)} m/s off the ground to ${round(runner.moveSpeed)} m/s`)
      test.ok(runner.moveSpeed > strafedFrom + 0.3,
        'air-strafing gains speed the ground maximum would never allow — this is what bunny-hopping is made of')
      // Pinned rather than left as "more than before", because a change that
      // halved the gain would still be more than before and would still have
      // taken bunny-hopping away from anybody who could do it.
      test.near(runner.moveSpeed, 7.35, 0.1, 'one hop turns 6.35 m/s into about 7.35 — a sixth again, which is the trade a real hop pays')

      // -------------------------------------------------------------- crouch
      drive(ducker, { wishCrouch: true }, 0.2)
      test.ok(ducker.crouched === true, 'the crouch wish ducks the body')
      test.near(ducker.collider.box[1], STANDING_HEIGHT / 2, 1e-9, 'halving the collider height')
      test.near(ducker.y - FLOOR, STANDING_HEIGHT / 4, 0.001, 'about the feet, so they stay on the floor')

      drive(ducker, { wishCrouch: true, wishStrafe: 1 }, 3)
      test.near(ducker.moveSpeed, 2.1, 0.01, 'and a ducked body moves at 2.1 m/s')
      test.ok(ducker.x - 0.405 > -14 && ducker.x + 0.405 < -10,
        `walked in under the ${GAP} m gap, which nothing standing up could have done`)

      drive(ducker, { wishCrouch: false, wishStrafe: 0 }, 0.5)
      test.ok(ducker.crouched === true, 'letting go of crouch under a lintel does not stand it up')
      test.near(ducker.collider.box[1], STANDING_HEIGHT / 2, 1e-9, 'the collider stays ducked')

      let backOut = 0
      while (ducker.crouched === true && backOut < 400) {
        ducker.wishCrouch = false
        ducker.wishStrafe = -1
        test.simulate(STEP)
        backOut++
      }
      test.ok(backOut < 400, 'it stands up the moment there is room again — the refusal is retried, not remembered')
      test.near(ducker.collider.box[1], STANDING_HEIGHT, 1e-9, 'back to full height')
      test.near(ducker.y - FLOOR, STANDING_HEIGHT / 2, 0.001, 'and grew about its feet rather than sinking into the floor')
      test.ok(ducker.x < -14.4 + 0.02, 'and not one step before the whole body was clear of the lintel')

      // ------------------------------------------------------ the human path
      // The only section that is about player-controlled: real bound keys, and
      // an aim that decides what forward means.
      park(human, -4, 15)
      view.yaw = 0
      test.hold('forward', 1)
      test.near(human.aimYaw, 0, 1e-9, 'player-controlled took the aim off the camera')
      test.ok(human.velocityZ < -6, 'holding the forward key moves the body the way the camera is looking')
      test.near(human.velocityX, 0, 1e-9, 'and nowhere else')

      park(human, 4, 15)
      view.yaw = Math.PI / 2
      test.hold('forward', 1)
      test.ok(human.velocityX < -6, 'turning the camera a quarter turn left turns what forward means with it')
      test.near(human.velocityZ, 0, 0.001, 'without leaking into the axis it left')
      test.near(human.rotation, 90, 1e-9, 'and the body model is turned to match, in the degrees the renderer wants')

      park(human, 4, 15)
      view.yaw = 0
      test.tap('crouch')
      test.ok(human.crouched === true, 'the crouch key ducks the body')
      test.near(human.collider.box[1], STANDING_HEIGHT / 2, 1e-9, 'to half height')
      test.simulate(0.1)
      test.ok(human.crouched === false, 'and releasing it stands back up where there is room')

      // --------------------------------------------------------- the two sides
      test.is(terrorist.properties.team, 'terrorist', 'a terrorist is on the terrorist team')
      test.is(counterTerrorist.properties.team, 'counter-terrorist', 'and a counter-terrorist on the other one')
      test.is(terrorist.properties.startingPistol, 'glock18', 'a terrorist starts on a Glock-18')
      test.is(counterTerrorist.properties.startingPistol, 'usp', 'a counter-terrorist on a USP')
      test.is(terrorist.collider.box, [0.81, STANDING_HEIGHT, 0.81], 'both are the Counter-Strike player hull, in metres')
      test.is(counterTerrorist.collider.box, [0.81, STANDING_HEIGHT, 0.81], 'the same on both sides, or one side is a smaller target')
      test.is(terrorist.properties.body, 'dynamic', 'and a body physics moves')
      test.ok(terrorist.behaviours.some(attached => attached.name === 'counter-strike-movement'),
        'a terrorist composes the one movement model')
      test.ok(counterTerrorist.behaviours.some(attached => attached.name === 'counter-strike-movement'),
        'and so does a counter-terrorist, because two movement models is two games')

      drive(terrorist, { wishForward: 1 }, 1.5)
      test.near(terrorist.moveSpeed, 6.35, 0.001, 'a terrorist runs at exactly the speed everything else does')
    } finally {
      // The view is session state rather than level state, so a level reload
      // would not put it back and the next test would start looking sideways.
      view.yaw = wasYaw
    }
  }
}

const round = n => Math.round(n * 1000) / 1000
