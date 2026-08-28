/**
 * Game Camera — the game camera, in two dimensions and in three.
 *
 * Until now the only camera was the editor's viewport: where *you* are looking
 * while building. A game needs a second one — where the *player* is looking
 * while playing — and they must not fight each other.
 *
 * So the editor's view is saved when play starts and put back when it stops.
 * Panning and zooming while editing is never overwritten by a level's rules.
 *
 * Declared in the level, because following the player is a property of the
 * level rather than of the player:
 *
 *   "camera": {
 *     "at": [7, 3], "zoom": 48,
 *     "follow": "player",          // a type name, or an entity id
 *     "lerp": 0.12,                // 1 = snap, lower = softer
 *     "bounds": [0, 0, 30, 12],    // never show outside this box
 *     "lookAhead": 0.35            // lead the direction of travel
 *   }
 *
 * Or, for a first-person shooter:
 *
 *   "camera": {
 *     "mode": "first-person", "follow": "player",
 *     "eyeHeight": 1.62, "crouchEyeHeight": 0.91, "fov": 90
 *   }
 *
 * And drivable for the moments a rule cannot express:
 *
 *   context.camera.follow(entity)   context.camera.moveTo(x, y)   context.camera.shake(0.4)
 *   context.camera.forward()        context.camera.right()
 *   context.camera.aim()            context.camera.punch(pitch, yaw)
 *
 * `context.view.mode` decides which camera runs, not the level rule — the rule
 * only sets the mode when play starts. That keeps the mode in one place, where a
 * test or a plugin can change it, instead of in two that can disagree.
 *
 * THE ANGLE CONVENTION, written down because a sign error here means the game
 * shoots backwards and nothing else in the codebase would notice:
 *
 *   Y is up. X and Z are the ground plane. Rotation order is YXZ, the same as
 *   the renderer's. `yaw` turns about +Y and `pitch` about +X, both in radians.
 *   At yaw 0, pitch 0 the eye faces -Z. Positive yaw turns LEFT; positive pitch
 *   looks UP.
 *
 *   forward = ( -sin(yaw)·cos(pitch),  sin(pitch),  -cos(yaw)·cos(pitch) )
 *   right   = (  cos(yaw),             0,           -sin(yaw)            )
 *
 *   Check it by hand: yaw 0 gives forward (0, 0, -1) and right (1, 0, 0), and
 *   right is forward × up, so the basis is right-handed the same way Three.js is.
 */

/** Counter-Strike's standing and ducked eye heights, in metres. */
const EYE_HEIGHT = 1.62
const CROUCH_EYE_HEIGHT = 0.91

/** Exactly 90 degrees makes the camera basis degenerate and the view rolls. */
const MAX_PITCH = 89 * Math.PI / 180

/**
 * Time constants for the things that ease, in seconds. Each is roughly a third
 * of the settling time you actually want, because an exponential is about 95%
 * of the way home after three of them.
 */
const EYE_EASE = 0.05          // ducking drops the eye over about 0.15 s
const RECOIL_DECAY = 0.09      // a kick is back on the aim within about 0.4 s
const DIP_DECAY = 0.09         // and so is the dip from a landing

/** Below this the recoil is not worth carrying, and aim() can report a clean zero. */
const SETTLED = 1e-5

/** View bob: small on purpose. A big one makes people ill. */
const BOB_RATE = 12            // radians of sine per second, so about two steps a second
const BOB_AMPLITUDE = 0.035    // metres at a full run
const RUN_SPEED = 6.35         // the speed the bob is measured against
const BOB_EASE = 0.07          // the bob fades in and out over about 0.2 s
const LANDING_DIP = 0.12       // metres, at a hard landing
const LANDING_FULL_DIP = 8     // the fall speed that earns the whole dip

/** How far a unit of shake throws the aim when there is no picture to slide. */
const SHAKE_RADIANS = 0.08

/**
 * The camera the running world is using, and the context it was handed.
 *
 * A test file is given the `test` object and nothing else, so there is otherwise
 * no way for one to ask where the view is pointing or to feed it a look. A
 * plugin module is a singleton in node and in the browser alike, so importing
 * this file from `project/tests` reaches the very object the live world uses.
 *
 * Null until the plugin has loaded. One process runs one world, which is what
 * makes a single handle honest — that is also the arrangement `--headless`
 * relies on for several agents to work at once.
 */
let running = null
export const runningCamera = () => running

export default {
  name: 'Game Camera',

  onLoad(context) {
    // All camera state lives on context.camera, so the system below and game code
    // are reading and writing the same one place.
    const cam = {
      target: null,
      rule: {},
      amount: 0,        // current shake, decaying
      editorView: null,

      // Recoil, as an offset on top of the aim rather than part of it, so it can
      // decay back to exactly where the player was pointing.
      punchYaw: 0,
      punchPitch: 0,
      // What that offset (plus shake) added to the view last step. Kept so the
      // next step can take it back off — see the system.
      appliedYaw: 0,
      appliedPitch: 0,

      eyeHeight: null,  // null until the first first-person step sets it
      dip: 0,           // the landing dip, in metres, decaying
      bobEffort: 0,     // how much bob is on the eye, eased rather than switched
      wasGrounded: false,
      fallSpeed: 0,     // last step's downward speed, because landing zeroes it

      /** Resolves when the level's camera block has been read. See readRule below. */
      ruleRead: Promise.resolve(),

      follow(entityOrId) {
        cam.target = typeof entityOrId === 'string'
          ? (context.world.byId(entityOrId) || context.world.find(entityOrId))
          : entityOrId
        return cam.target
      },
      moveTo(x, y) {
        context.view.x = x
        context.view.y = y
      },
      zoomTo(z) { context.view.zoom = z },

      /** Decays on the fixed clock, so it is the same length on every replay. */
      shake(amount = 0.3) { cam.amount = Math.max(cam.amount, amount) },

      /**
       * Where the shot goes: the aim the player is holding, plus the recoil
       * currently on it. Derived from the view rather than kept beside it, so a
       * weapon firing between steps cannot read a stale angle.
       *
       * Shake is deliberately not in here. A shake moves the picture; it must
       * not move the bullet, or a screen effect would decide a duel.
       */
      aim: () => ({
        yaw: wrapAngle(context.view.yaw - cam.appliedYaw + cam.punchYaw),
        pitch: clamp(context.view.pitch - cam.appliedPitch + cam.punchPitch, -MAX_PITCH, MAX_PITCH)
      }),

      /** Recoil. Pitch first, because a weapon kicks up far more than it kicks sideways. */
      punch(pitchRadians = 0, yawRadians = 0) {
        cam.punchPitch += pitchRadians
        cam.punchYaw += yawRadians
      },

      /** Unit vector the eye looks along, recoil included. See the convention above. */
      forward() {
        const { yaw, pitch } = cam.aim()
        const flat = Math.cos(pitch)
        return { x: -Math.sin(yaw) * flat, y: Math.sin(pitch), z: -Math.cos(yaw) * flat }
      },

      /**
       * Unit vector to the eye's right. Level on purpose — pitch must not tilt
       * strafing, or looking at the floor would walk you into it.
       */
      right() {
        const { yaw } = cam.aim()
        return { x: Math.cos(yaw), y: 0, z: -Math.sin(yaw) }
      }
    }
    context.camera = cam
    running = { camera: cam, context }

    /** What the rule says, applied to the view. Play starts here, and so does a late read. */
    function applyRule() {
      const v = context.view
      if (cam.rule.follow) cam.follow(cam.rule.follow)
      if (cam.rule.zoom) v.zoom = cam.rule.zoom
      if (cam.rule.mode) v.mode = cam.rule.mode
      if (cam.rule.fov) v.fov = cam.rule.fov
    }

    /**
     * Reading the level file is asynchronous, and a run with no screen can boot,
     * load and press play inside that read. So the handler below resets at once
     * and the rule catches up here — including applying itself, if play got
     * there first and found nothing to follow.
     */
    let loadedFor = null
    async function readRule(name) {
      let rule = {}
      try { rule = JSON.parse(await context.files.read(`levels/${name}.json`)).camera || {} }
      catch { rule = {} }
      // A newer level may have loaded while this read was in flight. It wins.
      if (loadedFor !== name) return
      cam.rule = rule
      if (context.loop.running) applyRule()
    }

    // The level's camera block is the rule; re-read it whenever a level loads.
    context.bus.on('level:loaded', name => {
      cam.target = null
      cam.rule = {}
      forget(cam)
      loadedFor = name
      // Held so a command can wait for it rather than report an empty rule as
      // though the level had declared none — the difference matters to an agent
      // asking what the camera is doing a millisecond after boot.
      cam.ruleRead = readRule(name)
    })

    context.bus.on('play:started', () => {
      const v = context.view
      // Everything the game camera is allowed to touch, so stopping puts all of
      // it back. Leaving `mode` out of this list strands the editor inside a
      // perspective camera pointing at a wall.
      cam.editorView = {
        x: v.x, y: v.y, z: v.z, zoom: v.zoom,
        mode: v.mode, yaw: v.yaw, pitch: v.pitch, fov: v.fov
      }
      forget(cam)
      applyRule()
    })

    context.bus.on('play:stopped', () => {
      // Put the editor back exactly where it was looking. Losing your place in
      // the level every time you press play is a small theft that makes an
      // editor tiring to use.
      if (cam.editorView) Object.assign(context.view, cam.editorView)
      cam.editorView = null
      cam.target = null
      forget(cam)
    })
  },

  systems: [{
    phase: 'fixed',
    run(world, seconds, context) {
      const cam = context.camera
      // Fixed systems only run while playing or simulating, so there is no
      // "am I in edit mode" check here.
      if (cam.target && !world.entities.includes(cam.target)) cam.target = null

      const view = context.view
      // You are inside your own body, so your own body must not be drawn to you.
      // The eye sits at chest height and a hand's width off the centre line, which
      // puts it inside the torso — the view fills with the inside of your own
      // shirt, and it reads as a wall rather than as a bug. Every first-person
      // game hides the local player's world model and shows only the viewmodel;
      // this is the one place that knows which body the camera is looking out of.
      hideWhatWeAreInside(cam, view.mode === 'first-person' ? cam.target : null)
      if (view.mode === 'first-person') { firstPerson(cam, view, seconds, context); return }

      // punch() is callable in any mode, so the recoil has to come off in any
      // mode. Decayed only inside the first-person branch, a kick applied while
      // the view was ortho stayed on aim() for the rest of the session.
      decayRecoil(cam, seconds)
      // And whatever the first-person path last added to the view goes back on
      // the step the mode changes, or leaving first person strands the kick on
      // the editor's own angles.
      if (cam.appliedYaw || cam.appliedPitch) {
        view.yaw -= cam.appliedYaw
        view.pitch -= cam.appliedPitch
        cam.appliedYaw = 0
        cam.appliedPitch = 0
      }

      // A camera with nothing to follow must not touch the view — an agent
      // calling simulate() while editing should not find its viewport moved.
      if (!cam.target) return

      const rule = cam.rule

      const lead = (rule.lookAhead ?? 0) * (cam.target.velocityX ?? 0)
      const k = clamp(rule.lerp ?? 0.12, 0, 1)
      view.x += (cam.target.x + lead - view.x) * k
      view.y += (cam.target.y + (rule.offsetY ?? 0) - view.y) * k

      if (rule.bounds) clampToBounds(view, rule.bounds, context.viewport)

      if (cam.amount > 0) {
        // context.random, not Math.random: a replay has to shake identically.
        view.x += context.random.range(-cam.amount, cam.amount)
        view.y += context.random.range(-cam.amount, cam.amount)
        cam.amount = Math.max(0, cam.amount - seconds * 2)
      }
    }
  }],

  commands: [{
    id: 'camera.state',
    label: 'Camera state',
    run: async context => {
      const cam = context.camera
      // The level's rule is read off disk, and this command is often the very
      // first thing a headless run asks. Waiting is the difference between
      // reporting the rule and reporting silence.
      await cam.ruleRead
      const view = context.view
      const aim = cam.aim()
      const firstPerson = view.mode === 'first-person'
      // The eye is only a player's eye when there is a player under it. With
      // nothing followed the view is the editor's own viewport, and reporting
      // that as "eye" told an agent the player was standing wherever the author
      // had last dragged the camera to.
      const onABody = firstPerson && !!cam.target
      return {
        view: {
          x: round(view.x),
          y: round(view.y),
          z: round(view.z),
          zoom: round(view.zoom),
          mode: view.mode,
          // Radians, the unit the whole engine works in. yaw 0 faces -Z.
          yaw: round(view.yaw),
          pitch: round(view.pitch),
          fov: view.fov
        },
        // Where the eye is and where it is actually pointing, so "what can the
        // player see right now" is one call rather than a screenshot.
        eye: onABody ? [round(view.x), round(view.y), round(view.z)] : null,
        aim: { yaw: round(aim.yaw), pitch: round(aim.pitch) },
        eyeHeight: onABody ? round(cam.eyeHeight ?? 0) : null,
        following: cam.target?.id ?? null,
        rule: cam.rule,
        notes: stateNotes(cam, view, context)
      }
    }
  }]
}

/**
 * What is worth saying out loud about the answer above.
 *
 * "Where is the player looking" and "where is the editor's viewport" are the
 * same three numbers when nothing is being followed, and the difference is the
 * whole question. Say which one this is rather than leaving it to be guessed.
 */
function stateNotes(cam, view, context) {
  const out = []
  if (!cam.target) {
    out.push(cam.rule.follow
      ? `nothing is being followed — the level's camera rule asks for "${cam.rule.follow}" and no entity in the level answers to it, so "view" is the editor's own viewport and not a player's eye`
      : 'nothing is being followed, so "view" is the editor\'s own viewport and not a player\'s eye')
  }
  if (!context.loop.running) out.push('the world is not running, so the camera system is not stepping — these are the numbers as they were left')
  return out
}

/**
 * The first-person camera: aim from the mouse, eye on the body, recoil on top.
 *
 * The order matters. The view carries the aim *plus* whatever recoil and shake
 * are adding to it this instant, so the first thing to do is take last step's
 * offset back off — otherwise the kick is added again every step and the aim
 * walks away from where the player is pointing and never comes back.
 */
function firstPerson(cam, view, seconds, context) {
  view.yaw -= cam.appliedYaw
  view.pitch -= cam.appliedPitch

  // context.input.look() is contributed by Mouse Look. A world without that
  // plugin simply does not turn, rather than throwing on every step — a camera
  // that cannot be aimed is a limitation, a camera that crashes is a broken game.
  const look = context.input?.look?.()
  if (look) {
    view.yaw += look.yaw || 0
    view.pitch += look.pitch || 0
  }
  // Wrapped rather than allowed to grow: after ten minutes of turning one way an
  // unwrapped yaw is a large float, and the trig starts losing precision.
  view.yaw = wrapAngle(view.yaw)
  view.pitch = clamp(view.pitch, -MAX_PITCH, MAX_PITCH)

  if (cam.target) moveEye(cam, view, seconds, context)

  // Recoil decays before it is applied, so the picture and aim() can never
  // disagree about how much kick is on the view right now.
  decayRecoil(cam, seconds)

  // A shake in first person moves the angles, not the eye. Sliding the eye
  // sideways reads as the whole world moving rather than as a knock.
  let shakeYaw = 0
  let shakePitch = 0
  if (cam.amount > 0) {
    const throwBy = cam.amount * SHAKE_RADIANS
    shakeYaw = context.random.range(-throwBy, throwBy)
    shakePitch = context.random.range(-throwBy, throwBy)
    cam.amount = Math.max(0, cam.amount - seconds * 2)
  }

  // Record what was added, exactly, including whatever the pitch clamp refused —
  // an approximate offset here would leak into the aim a little at a time.
  const pitched = clamp(view.pitch + cam.punchPitch + shakePitch, -MAX_PITCH, MAX_PITCH)
  cam.appliedPitch = pitched - view.pitch
  cam.appliedYaw = cam.punchYaw + shakeYaw
  view.pitch = pitched
  view.yaw += cam.appliedYaw
}

/**
 * Put the eye on the followed body.
 *
 * `entity.y` is the CENTRE of the body, so the feet are worked out from the
 * collider rather than guessed — a camera floating half a player above the head
 * is the kind of thing that looks almost right in a screenshot.
 */
function moveEye(cam, view, seconds, context) {
  const entity = cam.target
  const standing = cam.rule.eyeHeight ?? EYE_HEIGHT
  const ducked = cam.rule.crouchEyeHeight ?? CROUCH_EYE_HEIGHT

  // Crouching is a plain field on the entity. That is how two plugins that must
  // agree talk to each other in this engine — the camera cannot look a movement
  // behaviour up, and should not want to.
  const wants = crouching(entity) ? ducked : standing
  // Eased, not snapped: ducking in Counter-Strike is a smooth drop, and a snap
  // reads as a glitch rather than as a movement.
  if (cam.eyeHeight == null) cam.eyeHeight = wants
  cam.eyeHeight += (wants - cam.eyeHeight) * (1 - Math.exp(-seconds / EYE_EASE))

  const feet = entity.y - colliderHeight(entity) / 2

  view.x = entity.x
  view.z = entity.z
  view.y = feet + cam.eyeHeight + bob(cam, entity, seconds, context)
}

/**
 * The sine bob while walking, and the dip on landing.
 *
 * Driven by context.time rather than any wall clock, so a replay bobs
 * identically — the same rule every other moving thing in the engine follows.
 */
function bob(cam, entity, seconds, context) {
  const grounded = entity.grounded === true

  // Caught on the step `grounded` turns true, using the fall speed recorded the
  // step before: physics has already zeroed velocityY by the time we look.
  if (grounded && !cam.wasGrounded) {
    const impact = Math.min(1, Math.abs(cam.fallSpeed) / LANDING_FULL_DIP)
    cam.dip = Math.max(cam.dip, impact * LANDING_DIP)
  }
  cam.wasGrounded = grounded
  cam.fallSpeed = Math.min(0, entity.velocityY ?? 0)
  cam.dip = cam.dip * Math.exp(-seconds / DIP_DECAY)
  if (cam.dip < 0.0005) cam.dip = 0

  const speed = Math.hypot(entity.velocityX ?? 0, entity.velocityZ ?? 0)
  const wanted = grounded ? Math.min(1, speed / RUN_SPEED) : 0
  // Eased out, not switched off. The sine is anywhere in its cycle when the
  // player stops or leaves the ground, so cutting the bob in one step moves the
  // eye by up to a whole BOB_AMPLITUDE — a visible jolt at exactly the moment
  // the picture should settle. Fading the amplitude keeps the eye continuous.
  cam.bobEffort += (wanted - cam.bobEffort) * (1 - Math.exp(-seconds / BOB_EASE))
  return Math.sin(context.time * BOB_RATE) * BOB_AMPLITUDE * cam.bobEffort - cam.dip
}

/**
 * Recoil comes off on the fixed clock, in whatever mode the view is in.
 *
 * `punch()` is on context.camera unconditionally, so a weapon can kick while the
 * view is ortho, or while a level is mid-load. Decaying it only on the
 * first-person path made that kick permanent, and aim() would have reported it
 * for the rest of the session.
 */
function decayRecoil(cam, seconds) {
  const keep = Math.exp(-seconds / RECOIL_DECAY)
  cam.punchYaw = settle(cam.punchYaw * keep)
  cam.punchPitch = settle(cam.punchPitch * keep)
}

/** Forget everything transient. A kick or a half-finished duck must not survive a level load. */
/**
 * Hide the body the camera is looking out of, and give back the last one.
 *
 * Remembered rather than assumed: an entity may already be hidden for its own
 * reasons — a spectator, a marker, a corpse being cleared — and handing the
 * camera to somebody else must not reveal it. So only a body this function
 * hid is a body this function un-hides.
 *
 * Passing null is how the camera says "I am not inside anyone" — leaving first
 * person, stopping play, or losing the target — and it puts the last body back.
 */
function hideWhatWeAreInside(cam, body) {
  if (cam.insideOf === body) return
  if (cam.insideOf && cam.hidByCamera) cam.insideOf.hidden = false
  cam.insideOf = body || null
  cam.hidByCamera = false
  if (body && !body.hidden) {
    body.hidden = true
    cam.hidByCamera = true
  }
}

function forget(cam) {
  hideWhatWeAreInside(cam, null)
  cam.amount = 0
  cam.punchYaw = 0
  cam.punchPitch = 0
  cam.appliedYaw = 0
  cam.appliedPitch = 0
  cam.eyeHeight = null
  cam.dip = 0
  cam.bobEffort = 0
  cam.wasGrounded = false
  cam.fallSpeed = 0
}

/**
 * Keep the visible rectangle inside the level's box.
 *
 * Measured in world units from the viewport size and zoom, so the same bounds
 * behave the same in a small panel and on a full screen. If the level is
 * narrower than the screen, centre on it rather than jam against one edge.
 */
function clampToBounds(view, [x0, y0, x1, y1], viewport) {
  const halfW = viewport.width / 2 / view.zoom
  const halfH = viewport.height / 2 / view.zoom

  view.x = (x1 - x0) <= halfW * 2 ? (x0 + x1) / 2 : clamp(view.x, x0 + halfW, x1 - halfW)
  view.y = (y1 - y0) <= halfH * 2 ? (y0 + y1) / 2 : clamp(view.y, y0 + halfH, y1 - halfH)
}

/**
 * How tall a body is. A three-number box is a 3D collider and a two-number one
 * is the 2D box that was here first; the height is the second number either way.
 */
function colliderHeight(entity) {
  const collider = entity.collider
  if (!collider) return 0
  if (Array.isArray(collider.box)) return (collider.box[1] ?? 0) * (entity.scale ?? 1)
  if (typeof collider.circle === 'number') return collider.circle * 2 * (entity.scale ?? 1)
  return 0
}

const crouching = entity => entity.crouched === true || entity.properties?.crouched === true

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
const settle = a => (Math.abs(a) < SETTLED ? 0 : a)
const round = n => Math.round(n * 1000) / 1000

/** Into plus or minus PI, so a yaw that has been turning all game stays small. */
function wrapAngle(radians) {
  const shifted = (radians + Math.PI) % (Math.PI * 2)
  return shifted < 0 ? shifted + Math.PI : shifted - Math.PI
}
