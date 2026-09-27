/**
 * The third-person camera kind: an eye held behind a body, orbited by the mouse.
 *
 * It reads the body where it is DRAWN this frame, not where the last fixed step
 * left it, so the body holds still on screen at any refresh rate. Mouse turn and
 * wheel zoom are read on the same frame they are drawn.
 */
import { clamp } from '../game-maths/numbers.js'

/** Exactly 90 degrees makes the view basis degenerate. */
const PITCH_LIMIT = 89 * Math.PI / 180

export const DEFAULTS = {
  follow: null,
  distance: 5,
  minDistance: 1.5,
  maxDistance: 12,
  // Radians. Negative pitch looks down on the body.
  yaw: 0,
  pitch: -0.3,
  minPitch: -1.2,
  maxPitch: 0.3,
  // Metres above the body's centre that the camera looks at.
  offsetY: 0.6,
  // Metres to the camera's right, for an over-the-shoulder framing.
  side: 0,
  fov: 55,
  // Seconds for the look point to close most of the gap to the body. 0 is locked on.
  damping: 0,
  orbit: true,
  zoom: true
}

export default {
  about: 'an eye behind a body at a pitch, yaw and distance; the mouse orbits it and the wheel zooms',
  defaults: DEFAULTS,

  start(camera) {
    const settings = camera.settings
    camera.state = { yaw: settings.yaw, pitch: settings.pitch, distance: settings.distance, focus: null }
  },

  frame(camera, seconds, context) {
    const settings = camera.settings
    const state = camera.state
    turnFromInput(state, settings, context.input)

    const body = settings.follow ? context.world.byId(settings.follow) : null
    if (!body) return { following: null, problem: `no entity with id "${settings.follow}" to follow` }

    const place = context.world.drawnPlace(body, context.loop.blend)
    const wanted = { x: place.x, y: place.y + settings.offsetY, z: place.z }
    state.focus = settle(state.focus, wanted, settings.damping, seconds)
    placeView(context.view, state, settings)
    return { following: body.id }
  }
}

/** Mouse turn and wheel zoom, drained on the frame they are drawn. */
function turnFromInput(state, settings, input) {
  if (settings.orbit) {
    const turned = input?.look?.()
    if (turned) {
      state.yaw += turned.yaw || 0
      state.pitch += turned.pitch || 0
    }
  }
  if (settings.zoom) {
    const notches = input?.mouseWheel?.() || 0
    if (notches) state.distance *= Math.pow(1.12, notches)
  }
  state.yaw = Math.atan2(Math.sin(state.yaw), Math.cos(state.yaw))
  state.pitch = clamp(state.pitch, Math.max(settings.minPitch, -PITCH_LIMIT), Math.min(settings.maxPitch, PITCH_LIMIT))
  state.distance = clamp(state.distance, settings.minDistance, settings.maxDistance)
}

/** The look point, eased by `damping` seconds, or on the body when damping is 0. */
function settle(focus, wanted, damping, seconds) {
  if (!focus || !(damping > 0)) return wanted
  const share = 1 - Math.exp(-seconds / damping)
  return {
    x: focus.x + (wanted.x - focus.x) * share,
    y: focus.y + (wanted.y - focus.y) * share,
    z: focus.z + (wanted.z - focus.z) * share
  }
}

/** The eye behind the focus along the view's forward, in the engine's yaw and pitch convention. */
function placeView(view, state, settings) {
  const flat = Math.cos(state.pitch)
  view.mode = 'third-person'
  view.fov = settings.fov
  view.yaw = state.yaw
  view.pitch = state.pitch
  view.x = state.focus.x + Math.sin(state.yaw) * flat * state.distance + Math.cos(state.yaw) * settings.side
  view.y = state.focus.y - Math.sin(state.pitch) * state.distance
  view.z = state.focus.z + Math.cos(state.yaw) * flat * state.distance - Math.sin(state.yaw) * settings.side
}
