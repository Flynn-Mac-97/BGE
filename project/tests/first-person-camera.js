/**
 * The first-person camera: aim, clamp, wrap, basis vectors and recoil.
 *
 * A test is handed the `test` object and nothing else, so it cannot reach
 * `context.view` the way a plugin can — and the whole subject here is what the
 * view is doing. The Game Camera plugin exports `runningCamera()` for exactly
 * this: a plugin module is a singleton in node and in the browser alike, so
 * importing it here reaches the same camera the running world is using.
 *
 * Mouse Look contributes `context.input.look()`. If that plugin is not loaded
 * this test stands in for it, because what is under test is that the camera
 * consumes the contract — not that a mouse can produce it.
 */
import { runningCamera } from '../../plugins/builtin/camera.js'

/** The camera clamps here; exactly 90 degrees would let the view roll. */
const MAX_PITCH = 89 * Math.PI / 180

/** Only so a failure message names the angle in something readable. */
const round = n => Math.round(n * 1000) / 1000

export default {
  name: 'looking around aims the view, the pitch clamps, and recoil decays back onto the aim',
  level: 'level1',

  run(test) {
    const live = runningCamera()
    if (!live) return test.ok(false, 'the Game Camera plugin is loaded')

    const { camera, context } = live
    const view = context.view
    const player = test.entity('player-0')
    const restoreLook = standInForMouseLook(context, test)

    try {
      // level1 is a 2D level, so put the camera into first person by hand. The
      // system branches on view.mode, which is exactly what a level's
      // "mode": "first-person" sets when play starts.
      view.mode = 'first-person'
      view.yaw = 0
      view.pitch = 0
      camera.follow('player-0')
      test.is(camera.target?.id, 'player-0', 'the camera is following the player')

      // ---------------------------------------------------------------- aim
      context.input.lookBy(0.5, 0.2)
      test.simulate(1 / 60)
      test.near(view.yaw, 0.5, 1e-9, 'a look reached view.yaw')
      test.near(view.pitch, 0.2, 1e-9, 'and view.pitch')

      // The accumulator is cleared by the read, so a step with no mouse does not
      // keep turning.
      test.simulate(1 / 60)
      test.near(view.yaw, 0.5, 1e-9, 'one look turns the view once, not every step')

      // ------------------------------------------------------------- clamps
      context.input.lookBy(0, 10)
      test.simulate(1 / 60)
      test.near(view.pitch, MAX_PITCH, 1e-9, 'looking up clamps at 89 degrees')

      context.input.lookBy(0, -20)
      test.simulate(1 / 60)
      test.near(view.pitch, -MAX_PITCH, 1e-9, 'and looking down clamps at -89')

      view.yaw = 0
      context.input.lookBy(Math.PI * 1.5, 0)
      test.simulate(1 / 60)
      test.near(view.yaw, -Math.PI / 2, 1e-9, 'yaw wrapped into ±PI rather than growing')

      // ------------------------------------------------------------- basis
      view.yaw = 0
      view.pitch = 0
      const ahead = camera.forward()
      test.near(ahead.x, 0, 1e-9, 'forward at yaw 0 has no X')
      test.near(ahead.y, 0, 1e-9, 'forward at pitch 0 is level')
      test.near(ahead.z, -1, 1e-9, 'forward at yaw 0 points down -Z')

      const beside = camera.right()
      test.near(beside.x, 1, 1e-9, 'right at yaw 0 points down +X')
      test.near(beside.y, 0, 1e-9, 'right is level')
      test.near(beside.z, 0, 1e-9, 'right at yaw 0 has no Z')

      /**
       * Yaw 0 is the one angle where a sign error hides.
       *
       * right() is (cos(yaw), 0, -sin(yaw)), and at yaw 0 both the sin terms are
       * zero — so `-sin` and `+sin` give the identical answer and the test that
       * only checked yaw 0 could never fail for the reason it was written. A
       * quarter turn is where the two part company: turning left a quarter turn
       * leaves the player's right hand pointing down -Z, where they were facing
       * a moment ago. The wrong sign gives +Z, which is strafing backwards.
       */
      view.yaw = Math.PI / 2
      const quarter = camera.right()
      test.near(quarter.x, 0, 1e-9, 'right after a quarter turn left has no X')
      test.near(quarter.z, -1, 1e-9, 'and points down -Z — the wrong sign here strafes the player backwards')
      test.near(quarter.y, 0, 1e-9, 'and is still level')

      view.yaw = -Math.PI / 2
      test.near(camera.right().z, 1, 1e-9, 'and a quarter turn the other way puts right down +Z')

      // right is forward x up, which is what makes the basis right-handed the
      // same way Three.js is. Checked at an angle where every term is non-zero.
      view.yaw = 0.7
      view.pitch = 0.3
      const ahead2 = camera.forward()
      const beside2 = camera.right()
      test.near(ahead2.x * beside2.x + ahead2.y * beside2.y + ahead2.z * beside2.z, 0, 1e-9,
        'forward and right are perpendicular at an arbitrary yaw and pitch')

      // The spec says forward() is a unit vector, and nothing checked it. A
      // basis that is not unit length scales every bullet, every step and every
      // sightline by an amount that changes with where the player is looking.
      for (const [yaw, pitch] of [[0, 0], [0.7, 0.3], [-2.1, -0.9], [Math.PI, MAX_PITCH], [-Math.PI / 2, -MAX_PITCH]]) {
        view.yaw = yaw
        view.pitch = pitch
        const f = camera.forward()
        test.near(Math.hypot(f.x, f.y, f.z), 1, 1e-9, `forward() is unit length at yaw ${round(yaw)}, pitch ${round(pitch)}`)
        const r = camera.right()
        test.near(Math.hypot(r.x, r.y, r.z), 1, 1e-9, `right() is unit length at yaw ${round(yaw)}, pitch ${round(pitch)}`)
      }

      view.yaw = Math.PI / 2
      view.pitch = 0
      test.near(camera.forward().x, -1, 1e-9, 'a positive quarter turn faces -X, which is left of -Z')

      view.pitch = MAX_PITCH
      test.ok(camera.forward().y > 0.99, 'positive pitch looks up')

      // ------------------------------------------------------------ recoil
      view.yaw = 0
      view.pitch = 0
      camera.punch(0.05, 0.01)
      const kicked = camera.aim()
      test.near(kicked.pitch, 0.05, 1e-9, 'the punch is part of where the shot goes')
      test.near(kicked.yaw, 0.01, 1e-9, 'sideways too')
      test.ok(camera.forward().y > 0, 'forward() aims above the horizon while the kick is on')

      test.simulate(0.4)
      const settled = camera.aim()
      test.ok(Math.abs(settled.pitch) < 0.05 * 0.02, 'the kick is all but gone within 0.4 s')
      test.ok(Math.abs(settled.yaw) < 0.01 * 0.02, 'in yaw as well')

      test.simulate(0.5)
      test.near(camera.aim().pitch, 0, 1e-9, 'and decays the rest of the way to nothing')
      test.near(camera.aim().yaw, 0, 1e-9, 'in yaw as well')
      test.near(view.pitch, 0, 1e-9, 'the view ends up back on the aim it started from')
      test.near(view.yaw, 0, 1e-9, 'in yaw as well')

      // --------------------------------------------------------------- eye
      const feet = player.y - player.collider.box[1] / 2
      test.near(view.y, feet + 1.62, 0.02, 'the eye sits at standing eye height above the feet')
      test.near(view.x, player.x, 1e-9, 'the eye is at the body in X')
      test.near(view.z, player.z, 1e-9, 'and in Z')

      // Ducking eases rather than snapping, so one step in it is on its way
      // down but nowhere near arrived.
      player.crouched = true
      test.simulate(1 / 60)
      const dropping = view.y
      test.ok(dropping < feet + 1.62 - 0.01, 'the eye starts dropping when the body ducks')
      test.ok(dropping > feet + 0.91 + 0.1, 'but has not arrived — the duck eases rather than snapping')
      test.simulate(0.25)
      test.near(view.y, feet + 0.91, 0.02, 'and arrives at the crouched eye height')
      player.crouched = false

      // ------------------------------------------------------ the 2D camera
      // The path this plugin started as has to still work. Put it back into
      // ortho and check the follow still lerps toward the body.
      view.mode = 'ortho'
      view.x = 0
      view.y = 0
      test.simulate(0.5)
      test.near(view.x, player.x, 0.3, 'the 2D follow still lerps toward the body')
      test.near(view.y, player.y, 0.3, 'in Y as well')
    } finally {
      restoreLook()
    }
  }
}

/**
 * Give context.input the look accumulator Mouse Look is supposed to contribute,
 * if it is not there yet, and take it away again afterwards.
 */
function standInForMouseLook(context, test) {
  const input = context.input
  if (typeof input.look === 'function' && typeof input.lookBy === 'function') {
    test.note('Mouse Look is loaded — driving the real accumulator')
    return () => {}
  }

  test.note('Mouse Look is not loaded — standing in for context.input.look()')
  const had = { look: input.look, lookBy: input.lookBy }
  let yaw = 0
  let pitch = 0

  input.lookBy = (byYaw = 0, byPitch = 0) => { yaw += byYaw; pitch += byPitch }
  input.look = () => {
    const since = { yaw, pitch }
    yaw = 0
    pitch = 0
    return since
  }

  return () => { input.look = had.look; input.lookBy = had.lookBy }
}
