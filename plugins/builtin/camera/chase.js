/**
 * Game Camera: the chase camera — an eye held behind a followed body, eased on
 * its focus, placed again each drawn frame, and eased to a close shot and back.
 */
import { MAX_PITCH, wrapAngle } from './angles.js'
import { clamp } from '../game-maths/vectors.js'

/**
 * Where a chase camera sits when the level does not say.
 *
 * Deliberately a survivor's framing rather than a shooter's: far enough back to
 * show the crowd closing in, and steep enough that the floor is most of the
 * picture. A level that wants a shoulder says so in three numbers.
 */
const CHASE_DISTANCE = 14
const CHASE_PITCH = -1.05

/**
 * The chase camera: an eye held at a fixed angle and distance from the body.
 *
 * A third-person camera is one idea — an offset kept behind a point of interest
 * — and the level's three numbers decide which game it reads as. A steep pitch
 * and fifteen metres is a survivor looking down on a crowd; a shallow pitch and
 * three is over a shoulder. There is no second camera for the second case.
 *
 * The FOCUS is what eases, never the eye. Ease the eye and the lag shows up as
 * a swing about the body rather than as a slide, so the picture rolls when the
 * player changes direction and the body drifts off centre by an amount that
 * depends on which way it is running. Easing what the camera is LOOKING at and
 * then placing the eye exactly behind it keeps the body where the player put it.
 */
export function thirdPerson(cam, view, seconds, context) {
  const rule = cam.rule
  const body = cam.target

  // `lookAhead` is in seconds of travel, so the lead is a distance the player
  // can feel — a quarter of a second ahead is a quarter of a second ahead at
  // any speed, and it does not have to be retuned when the speed changes.
  const lead = rule.lookAhead ?? 0
  const lens = easeLens(cam, view, seconds)
  const wanted = {
    x: body.x + (body.velocityX ?? 0) * lead,
    y: body.y + lens.offsetY,
    z: (body.z ?? 0) + (body.velocityZ ?? 0) * lead
  }
  if (rule.bounds) holdInside(wanted, rule.bounds)

  // `lerp` is a fraction per step, which is how the 2D camera has always read
  // it, corrected for the length of the step. Without the correction the same
  // level settles at a different speed the moment the fixed rate changes, and
  // the softness an author tuned by eye is silently retuned for them.
  const perStep = clamp(rule.lerp ?? 0.15, 0, 1)
  const k = perStep >= 1 ? 1 : 1 - Math.pow(1 - perStep, seconds * 60)
  // Snapped on the first step, so a level does not open with the camera flying
  // in from wherever the editor left it.
  if (!cam.focus) cam.focus = { ...wanted }
  cam.focusBefore = { ...cam.focus }
  cam.focus.x += (wanted.x - cam.focus.x) * k
  cam.focus.y += (wanted.y - cam.focus.y) * k
  cam.focus.z += (wanted.z - cam.focus.z) * k

  // The angle lives on the view, not in the rule, so anything that wants to
  // swing the camera round writes view.yaw and this reads it back.
  view.pitch = clamp(view.pitch ?? CHASE_PITCH, -MAX_PITCH, MAX_PITCH)
  view.yaw = wrapAngle(view.yaw || 0)

  // A knock moves the camera here, not the aim. The camera is a thing out in
  // the world in third person, and turning it instead would swing the whole
  // picture about the player rather than jolt it.
  cam.knock = { x: 0, y: 0, z: 0 }
  if (cam.amount > 0) {
    cam.knock = {
      x: context.random.range(-cam.amount, cam.amount),
      y: context.random.range(-cam.amount, cam.amount),
      z: context.random.range(-cam.amount, cam.amount)
    }
    cam.amount = Math.max(0, cam.amount - seconds * 2)
  }
  placeChaseEye(cam, view, cam.focus)
}

/** Seconds a close shot takes to settle, as an exponential ease. */
const SHOT_EASE = 0.12

/**
 * Ease the chase camera's distance and height toward the close shot asked for,
 * or back to the level's; and its pitch toward the shot's, or back to where it
 * was before. Answers `cam.lens`, `{ distance, offsetY }`.
 */
function easeLens(cam, view, seconds) {
  const rule = cam.rule
  const wanted = cam.shot ?? { distance: rule.distance ?? CHASE_DISTANCE, offsetY: rule.offsetY ?? 0, pitch: cam.pitchBefore }
  const share = 1 - Math.exp(-seconds / SHOT_EASE)
  cam.lens ??= { distance: wanted.distance, offsetY: wanted.offsetY }
  cam.lens.distance += (wanted.distance - cam.lens.distance) * share
  cam.lens.offsetY += (wanted.offsetY - cam.lens.offsetY) * share
  if (wanted.pitch == null) return cam.lens
  view.pitch = (view.pitch ?? CHASE_PITCH) + (wanted.pitch - (view.pitch ?? CHASE_PITCH)) * share
  // Home again: the view's pitch is its own from here on.
  if (!cam.shot && Math.abs(wanted.pitch - view.pitch) < 1e-3) cam.pitchBefore = null
  return cam.lens
}

/**
 * Put the chase eye behind a focus point, at the view's angle and the rule's
 * distance, plus this step's knock.
 *
 * The eye is the focus minus the distance along forward — see the angle
 * convention at the top of this file, which is where these signs come from.
 */
function placeChaseEye(cam, view, focus) {
  const distance = Math.max(0, cam.lens?.distance ?? cam.rule.distance ?? CHASE_DISTANCE)
  const flat = Math.cos(view.pitch)
  view.x = focus.x + Math.sin(view.yaw) * flat * distance + cam.knock.x
  view.y = focus.y - Math.sin(view.pitch) * distance + cam.knock.y
  view.z = focus.z + Math.cos(view.yaw) * flat * distance + cam.knock.z
}

/**
 * Place the chase eye for the frame being drawn, not the last fixed step.
 *
 * The renderer draws each body `blend` of the way between its last two steps.
 * An eye placed only on the fixed step moves in steps under a body that moves
 * smoothly, so on a display faster than the step the body shakes on screen.
 * The focus is blended the same way, so the two move together.
 */
export function placeChaseEyeForFrame(cam, view, blend) {
  if (!cam.focus || !cam.focusBefore) return
  const focus = {
    x: cam.focusBefore.x + (cam.focus.x - cam.focusBefore.x) * blend,
    y: cam.focusBefore.y + (cam.focus.y - cam.focusBefore.y) * blend,
    z: cam.focusBefore.z + (cam.focus.z - cam.focusBefore.z) * blend
  }
  placeChaseEye(cam, view, focus)
}

/**
 * Keep a point on the ground inside the level's box.
 *
 * Four numbers, and in three dimensions they are the ground plane: x0, z0, x1,
 * z1. The flat camera's `bounds` are x0, y0, x1, y1 because in two dimensions
 * the ground IS x and y — the same rectangle, read on the plane the game is
 * played on.
 *
 * It holds the point the camera looks at rather than the rectangle it can see.
 * Working out what a pitched perspective camera can see means projecting four
 * frustum corners onto the floor and taking their hull, which is real machinery
 * for an arena whose edge the player is not supposed to reach anyway.
 */
function holdInside(point, [x0, z0, x1, z1]) {
  point.x = x1 <= x0 ? (x0 + x1) / 2 : clamp(point.x, x0, x1)
  point.z = z1 <= z0 ? (z0 + z1) / 2 : clamp(point.z, z0, z1)
}
