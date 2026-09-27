/**
 * 3D View — fly the editor viewport around the level.
 *
 * The editor opens every level in the flat ortho view: it is the one view that
 * is safe to show a 3D map in, and it is the view tools were written against.
 * But a 3D level that you can only look down on is a level you cannot see —
 * the geometry that matters is the geometry at eye height, not the floor plan.
 *
 * So this is the editor's own fly camera. It is NOT the game camera: it never
 * touches the level's `camera` block, it does nothing while play is running,
 * and the moment play starts the game camera takes over exactly as it always
 * did. It is a viewport state, like pan and zoom, and it is remembered across
 * play sessions and level reloads.
 *
 *   run view.3d            toggle the 3D view
 *   run view.3d true       on, or false to leave it
 *
 * In the 3D view, while nothing is playing:
 *
 *   WASD            move, in the direction the camera faces
 *   Q / E           down / up
 *   Shift           three times faster
 *   drag            look around (middle or right button — left still selects)
 *   wheel           dolly in and out
 *
 * The engine's perspective camera and picking already exist — the renderer
 * draws any mode other than 'ortho' through the yaw/pitch/fov camera, and
 * picking and toWorld resolve against it. This plugin supplies the missing
 * half: the input that moves it.
 */
import { clamp } from './game-maths/numbers.js'

const LOOK_RADIANS = 0.005          // radians per pixel of drag
const SPEED = 10                    // metres per second, base
const BOOST = 3                     // how much faster Shift is
const DOLLY_PER_NOTCH = 3           // metres forward per wheel notch
const MAX_PITCH = 1.5               // radians, about 86 degrees — never quite straight down

const state = {
  active: false,
  ortho: null,        // { x, y, zoom } to come home to
  pose: null,         // { x, y, z, yaw, pitch, fov } the last 3D place
  keys: new Set(),    // codes currently held
  look: null,         // { x, y } the drag in flight, or null
  last: 0             // last frame timestamp, for movement
}

export default {
  name: '3D View',
  category: 'visuals',
  about: 'Fly the editor viewport.',
  inspect: context => {
    const v = context.view
    if (v.mode !== '3d') return [{ title: '3D View', rows: [['mode', 'ortho — 2D view']] }]
    return [{
      title: '3D View',
      rows: [
        ['at', `${round(v.x)}, ${round(v.y)}, ${round(v.z || 0)}`],
        ['yaw', round(v.yaw || 0)],
        ['pitch', round(v.pitch || 0)]
      ]
    }]
  },

  menus: [{
    id: 'view.3d',
    label: '3D',
    title: 'Fly the viewport in 3D — WASD + Q/E to move, drag to look, wheel to dolly',
    on: () => state.active,
    run: context => { toggle(context); context.redraw() }
  }],

  commands: [
    {
      id: 'view.3d',
      label: 'Toggle 3D camera',
      // run view.3d          — toggle
      // run view.3d true     — on
      // run view.3d false    — off
      run: (context, on) => {
        toggle(context, on === undefined ? !state.active : !!on)
        context.redraw?.()
        return report(context)
      }
    },
    {
      id: 'view.3d.report',
      label: 'Viewport aim',
      run: context => report(context)
    }
  ],

  onLoad(context) {
    // The viewport only exists in a browser; headless, the commands still work
    // (mode is view state, not a screen), the input simply never attaches.
    context.bus.on('shell:ready', () => attach(context))

    // Play puts the game camera in charge, and stopping play reloads the level,
    // which opens in ortho by design. If the editor was in 3D, put it back —
    // the author's place is theirs, not the level's to take.
    context.bus.on('level:loaded', () => {
      if (!state.active) return
      // loadLevel just reset the view from the level's camera block; that flat
      // position is the ortho home now.
      state.ortho = { x: context.view.x, y: context.view.y, zoom: context.view.zoom }
      applyPose(context)
    })
  }
}

// ------------------------------------------------------------------ toggle
/**
 * `on` is true to enter 3D, false to leave it, and undefined to flip —
 * the toolbar button and a bare `run view.3d` both mean "the other one".
 */
function toggle(context, on) {
  const want = on === undefined ? !state.active : !!on
  if (want === state.active) return
  if (want) enter(context)
  else exit(context)
}

function enter(context) {
  const v = context.view
  state.ortho = { x: v.x, y: v.y, zoom: v.zoom }

  if (!state.pose) {
    // First time: look down at the flat view's centre from above and behind
    // it. Y is up, so the height goes on y; at the flat view's own y a floor is
    // seen edge-on. The eye is straight back along +Z, so yaw 0 faces the centre.
    state.pose = {
      x: v.x, y: v.y + 8, z: 14,
      yaw: 0, pitch: -0.5, fov: v.fov || 90
    }
  }
  state.active = true
  applyPose(context)
}

function exit(context) {
  // Wherever the fly camera ended up is the next fly camera's start.
  const v = context.view
  state.pose = { x: v.x, y: v.y, z: v.z || 0, yaw: v.yaw || 0, pitch: v.pitch || 0, fov: v.fov || 90 }
  state.active = false
  if (state.ortho) {
    v.mode = 'ortho'
    v.x = state.ortho.x
    v.y = state.ortho.y
    v.zoom = state.ortho.zoom
  }
}

function applyPose(context) {
  const v = context.view
  const p = state.pose
  v.mode = '3d'
  v.x = p.x; v.y = p.y; v.z = p.z
  v.yaw = p.yaw; v.pitch = p.pitch; v.fov = p.fov
}

function report(context) {
  const v = context.view
  return {
    mode: v.mode,
    active: state.active,
    ...(v.mode === '3d'
      ? { at: [round(v.x), round(v.y), round(v.z || 0)], yaw: round(v.yaw || 0), pitch: round(v.pitch || 0), fov: round(v.fov || 90) }
      : { at: [round(v.x), round(v.y)], zoom: round(v.zoom) })
  }
}

// ------------------------------------------------------------------ input
/**
 * The half that needs a document. Everything here is guarded by `editing` and
 * `context.loop.running`, so typing in the code panel never flies the camera
 * and play mode is never fought over.
 */
function attach(context) {
  const viewport = context.shell.viewport
  if (!viewport) return

  const in3d = () => state.active && context.view.mode === '3d' && !context.loop.running

  // Capture phase, so the fly camera sees a gesture before the transform tool
  // does and can stop it — in 3D a middle or right drag is a look, not a pan
  // or a context menu. The left button is deliberately left alone: picking
  // works through the perspective camera, so selecting in 3D is the same
  // gesture it always was. (Space+left is the ortho pan; in 3D it is a look,
  // so it is intercepted too rather than yanking the camera sideways.)
  viewport.addEventListener('pointerdown', event => {
    if (!in3d()) return
    const isLookButton = event.button === 1 || event.button === 2 ||
      (event.button === 0 && state.keys.has('Space'))
    if (!isLookButton) return
    event.preventDefault()
    event.stopPropagation()
    state.look = { x: event.clientX, y: event.clientY, moved: false }
    viewport.setPointerCapture(event.pointerId)
  }, { capture: true })

  viewport.addEventListener('pointermove', event => {
    if (!state.look) return
    if (!in3d()) { state.look = null; return }
    const dx = event.clientX - state.look.x
    const dy = event.clientY - state.look.y
    state.look = { ...state.look, x: event.clientX, y: event.clientY, moved: state.look.moved || Math.hypot(dx, dy) > 3 }

    const v = context.view
    v.yaw = (v.yaw || 0) - dx * LOOK_RADIANS
    v.pitch = clamp((v.pitch || 0) - dy * LOOK_RADIANS, -MAX_PITCH, MAX_PITCH)
  })

  const endLook = () => { state.look = null }
  viewport.addEventListener('pointerup', endLook)
  viewport.addEventListener('pointercancel', endLook)

  // Right-drag is a look in 3D, so the browser's menu must not appear over it.
  // A right-CLICK (no movement) still gets the transform tool's pile — that is
  // how you pick between overlapping geometry in a perspective view.
  viewport.addEventListener('contextmenu', event => {
    if (!in3d()) return
    if (state.look?.moved) { event.preventDefault(); event.stopPropagation() }
  }, { capture: true })

  // In 3D the wheel is a dolly (move toward what you are looking at), not the
  // ortho zoom. One notch per browser's own unit, the same rule mouse-look uses.
  viewport.addEventListener('wheel', event => {
    if (!in3d()) return
    event.preventDefault()
    event.stopPropagation()
    const perNotch = [100, 3, 1][event.deltaMode] || 100
    const notches = Number(event.deltaY) / perNotch
    if (!Number.isFinite(notches)) return
    moveAlongView(context, notches * DOLLY_PER_NOTCH)
  }, { capture: true })

  const editing = element => ['INPUT', 'TEXTAREA'].includes(element?.tagName)

  addEventListener('keydown', event => {
    if (!in3d()) return
    if (editing(event.target)) return
    state.keys.add(event.code)
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'Space'].includes(event.code)) event.preventDefault()
  })
  addEventListener('keyup', event => state.keys.delete(event.code))
  addEventListener('blur', () => state.keys.clear())

  // Movement on its own loop, because nothing else ticks while editing — the
  // engine's frame systems only run while playing, and this is a viewport tool.
  if (typeof requestAnimationFrame !== 'function') return
  const frame = now => {
    requestAnimationFrame(frame)
    if (!in3d()) { state.last = 0; return }
    const dt = state.last ? Math.min(0.05, (now - state.last) / 1000) : 1 / 60
    state.last = now
    move(context, dt)
    // The skybox's frame system also only runs while playing, so in the 3D
    // edit view the sky would stay wherever play last left it. Ride it with
    // the eye the same way that system does.
    const sky = context.skybox?.skyMesh
    if (sky?.isMesh) {
      sky.position.set(context.view.x, context.view.y, context.view.z || 0)
    }
    // The view moved; the editor repaints on its own idle loop, so nothing to
    // draw here — but the pose is the one a later level load must restore.
    state.pose = {
      x: context.view.x, y: context.view.y, z: context.view.z || 0,
      yaw: context.view.yaw || 0, pitch: context.view.pitch || 0, fov: context.view.fov || 90
    }
  }
  requestAnimationFrame(frame)
}

// ------------------------------------------------------------------ movement
/**
 * WASD moves along the camera's facing (yaw AND pitch — you fly toward where
 * you are looking), Q/E are the two world-vertical ways. Shift multiplies.
 */
function move(context, dt) {
  const v = context.view
  const speed = SPEED * (state.keys.has('ShiftLeft') || state.keys.has('ShiftRight') ? BOOST : 1)

  const forward = v.yaw || 0
  const pitch = v.pitch || 0
  // The same basis the game camera documents: yaw turns left around +Y, pitch
  // looks up around +X, and at 0/0 the eye faces -Z.
  const fx = -Math.sin(forward) * Math.cos(pitch)
  const fy = Math.sin(pitch)
  const fz = -Math.cos(forward) * Math.cos(pitch)
  const rx = Math.cos(forward)
  const rz = -Math.sin(forward)

  let mx = 0, my = 0, mz = 0
  if (state.keys.has('KeyW')) { mx += fx; my += fy; mz += fz }
  if (state.keys.has('KeyS')) { mx -= fx; my -= fy; mz -= fz }
  if (state.keys.has('KeyD')) { mx += rx; mz += rz }
  if (state.keys.has('KeyA')) { mx -= rx; mz -= rz }
  if (state.keys.has('KeyE')) my += 1
  if (state.keys.has('KeyQ')) my -= 1

  if (!mx && !my && !mz) return
  const length = Math.hypot(mx, my, mz) || 1
  v.x += mx / length * speed * dt
  v.y += my / length * speed * dt
  v.z += mz / length * speed * dt
}

/** Step toward or away from the point the camera faces, wheel style. */
function moveAlongView(context, metres) {
  const v = context.view
  const yaw = v.yaw || 0
  const pitch = v.pitch || 0
  v.x += -Math.sin(yaw) * Math.cos(pitch) * metres
  v.y += Math.sin(pitch) * metres
  v.z += -Math.cos(yaw) * Math.cos(pitch) * metres
}

// ------------------------------------------------------------------ small print
const round = n => Math.round(n * 1000) / 1000
