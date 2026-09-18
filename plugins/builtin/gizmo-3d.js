/**
 * 3D Transform Gizmo — move, rotate and scale the selection in the 3D view.
 *
 * The 2D transform tool is ortho-shaped: its handles are drawn over the flat
 * view and its drags are computed in screen pixels. In the 3D view that math
 * has no meaning, so this is the same tool drawn INSIDE the scene — real
 * geometry at the selection's position, picked by real rays, dragged along
 * world axes.
 *
 * It matches what the engine's entity model can actually express. An entity
 * has one rotation — degrees about Y, the way a wall faces — and one uniform
 * scale, so the gizmo offers:
 *
 *   G  move     three axis arrows, three plane squares, and a free-move centre
 *   R  rotate   one ring about Y (the only axis entities rotate about)
 *   S  scale    one handle (the only scale entities have)
 *
 * A three-ring rotate gizmo would edit fields the engine does not have; this
 * is the honest version, and it is the same vocabulary the level file speaks.
 *
 * Dragging works on the gizmo itself, and — like the 2D tool — directly on a
 * selected entity, which free-moves in the plane facing the camera. Shift
 * snaps rotation to 15 degrees; holding control/command turns snapping off.
 *
 * The gizmo only appears in the 3D view with something selected, and never
 * while play is running: the game camera owns the viewport then.
 */
const GRID = 0.5               // move snap, the same grid the 2D tool uses
const ROTATE_SNAP = 15         // degrees, with shift
const SCALE_SNAP = 0.05        // steps, unless control is held

const COLOUR = {
  x: '#e04b3c', y: '#3fb94f', z: '#3c7de0',
  centre: '#f0f0f0', ring: '#f0c040', cube: '#f0f0f0'
}

const state = {
  mode: 'move',        // move | rotate | scale
  space: false,        // held — the 3D view's look gesture, so hands off
  drag: null,          // the drag in flight
  last: 0              // frame timestamp
}

export default {
  name: '3D Transform Gizmo',
  category: 'editor',
  about: 'Move, rotate and scale the selection in the 3D view — real geometry in the scene, dragged along world axes.',
  inspect: context => [{
    title: 'Gizmo',
    rows: [
      ['mode', state.mode],
      ['visible', visibleFor(context) ? 'yes' : 'no'],
      ['drag', state.drag ? state.drag.kind : 'none']
    ]
  }],

  commands: [
    {
      id: 'gizmo3d.mode',
      label: 'Set the 3D gizmo mode (move, rotate, scale)',
      // run gizmo3d.mode rotate
      run: (context, mode) => {
        const wanted = String(mode || '').toLowerCase()
        if (!['move', 'rotate', 'scale'].includes(wanted)) {
          throw new Error(`gizmo3d.mode takes move, rotate or scale, not "${mode}"`)
        }
        state.mode = wanted
        context.redraw?.()
        return { mode: state.mode }
      }
    },
    {
      id: 'gizmo3d.state',
      label: 'What the 3D gizmo is doing',
      run: context => ({
        mode: state.mode,
        visible: visibleFor(context),
        drag: state.drag?.kind || null,
        selection: context.selection.length
      })
    }
  ],

  onLoad(context) {
    context.bus.on('shell:ready', () => attach(context))
  }
}

// ------------------------------------------------------------------ visibility
function visibleFor(context) {
  return context.view?.mode === '3d' && context.selection.length > 0 && !context.loop?.running
}

// ------------------------------------------------------------------ the scene
let THREE = null
let gizmo = null        // { group, parts, raycaster }

function attach(context) {
  const viewport = context.shell.viewport
  if (!viewport) return
  const { renderer, world, editor, bus } = context

  // Three loads on demand, like the other viewport plugins: a world with
  // nothing drawing must not pay to parse a renderer library.
  import('three/webgpu').then(THREEModule => {
    THREE = THREEModule
    gizmo = buildGizmo(THREE, renderer.scene)
    renderer.scene.add(gizmo.group)
  }).catch(e => console.error(`[gizmo3d] could not load three, so the 3D gizmo will not draw — ${e.message}`))

  const sel = () => context.selection
  const pt = event => { const r = viewport.getBoundingClientRect(); return { x: event.clientX - r.left, y: event.clientY - r.top } }
  const in3d = () => context.view?.mode === '3d' && !context.loop?.running

  // ---------------------------------------------------------------- update
  function place() {
    if (!gizmo || !gizmo.group) return
    const visible = visibleFor(context)
    gizmo.group.visible = visible
    if (!visible) return

    const list = sel()
    const pivot = centroid(list)
    const size = gizmoSize(context, list)
    gizmo.group.position.set(pivot.x, pivot.y, pivot.z || 0)
    gizmo.group.scale.setScalar(size)

    // Only the current mode's parts show.
    for (const [name, obj] of Object.entries(gizmo.parts)) {
      obj.visible = name === state.mode
    }
  }

  // ---------------------------------------------------------------- input
  viewport.addEventListener('pointerdown', event => {
    if (!in3d() || event.button !== 0 || state.space) return
    if (!gizmo) return
    const p = pt(event)

    // A gizmo handle first: the ray meets real geometry, and the first hit
    // names the drag.
    const part = hitGizmo(renderer, gizmo, p)
    if (part) {
      event.preventDefault()
      event.stopPropagation()
      viewport.setPointerCapture(event.pointerId)
      startDrag(context, renderer, part, p)
      return
    }

    // Then the world. A hit on a selected entity starts a free move in the
    // plane facing the camera; a hit on anything else selects it; empty
    // space clears the selection. The 2D tool's gestures are all ortho math,
    // so in 3D this plugin owns the viewport.
    const [hit] = renderer.pick(world, p.x, p.y)
    event.preventDefault()
    event.stopPropagation()
    if (hit) {
      const wasSelected = editor.selection.has(hit.id)
      if (event.shiftKey) {
        wasSelected ? editor.selection.delete(hit.id) : editor.selection.add(hit.id)
        bus.emit('selection:changed')
      } else if (!wasSelected) {
        context.select(hit.id)
      }
      if (editor.selection.has(hit.id)) {
        viewport.setPointerCapture(event.pointerId)
        startDrag(context, renderer, { kind: 'free' }, p)
      }
    } else if (!event.shiftKey) {
      context.select([])
    }
    context.redraw()
  }, { capture: true })

  viewport.addEventListener('pointermove', event => {
    if (!gizmo || !state.drag) return
    if (!in3d()) { state.drag = null; return }
    const p = pt(event)
    dragMove(context, renderer, p, event)
  })

  const endDrag = () => {
    if (!state.drag) return
    const moved = state.drag.moved
    state.drag = null
    if (moved) context.save()
    context.redraw()
  }
  viewport.addEventListener('pointerup', endDrag)
  viewport.addEventListener('pointercancel', endDrag)

  // G/R/S switch the mode; everything else is the fly camera's.
  const editing = element => ['INPUT', 'TEXTAREA'].includes(element?.tagName)
  addEventListener('keydown', event => {
    if (!in3d() || editing(event.target)) return
    if (event.code === 'Space') state.space = true
    const mode = { KeyG: 'move', KeyR: 'rotate', KeyS: 'scale' }[event.code]
    if (mode && mode !== state.mode) {
      state.mode = mode
      event.preventDefault()
      place(); context.redraw()
    }
  })
  addEventListener('keyup', event => { if (event.code === 'Space') state.space = false })
  addEventListener('blur', () => { state.space = false; state.drag = null })

  // Follow the selection as it changes, and ride out the fly camera's drags.
  bus.on('selection:changed', place)
  bus.on('world:changed', place)
  bus.on('level:loaded', place)
  const spin = () => { if (gizmo && visibleFor(context)) place(); requestAnimationFrame(spin) }
  requestAnimationFrame(spin)
}

// ------------------------------------------------------------------ building
function buildGizmo(THREE, scene) {
  const group = new THREE.Group()
  group.visible = false
  group.userData.gizmo = true   // editor furniture — never casts, never bakes
  const parts = {}

  // --- move: three arrows, three plane squares, a free-move centre ---
  const move = new THREE.Group()
  move.userData.gizmo = 'move'
  move.add(arrow(THREE, [1, 0, 0], COLOUR.x))
  move.add(arrow(THREE, [0, 1, 0], COLOUR.y))
  move.add(arrow(THREE, [0, 0, 1], COLOUR.z))
  move.add(plane(THREE, 'xy', COLOUR.z))
  move.add(plane(THREE, 'xz', COLOUR.y))
  move.add(plane(THREE, 'yz', COLOUR.x))

  const centre = new THREE.Mesh(
    new THREE.SphereGeometry(0.12, 16, 12),
    basic(THREE, COLOUR.centre)
  )
  centre.userData.gizmo = 'free'
  move.add(centre)

  // --- rotate: one ring about Y, the only axis entities rotate about ---
  const rotate = new THREE.Group()
  rotate.userData.gizmo = 'rotate'
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.85, 0.03, 8, 48),
    basic(THREE, COLOUR.ring)
  )
  ring.userData.gizmo = 'rotate'
  ring.rotation.x = Math.PI / 2        // lie flat in the XZ plane
  rotate.add(ring)

  // --- scale: one uniform handle, the only scale entities have ---
  const scale = new THREE.Group()
  scale.userData.gizmo = 'scale'
  const cube = new THREE.Mesh(
    new THREE.BoxGeometry(0.22, 0.22, 0.22),
    basic(THREE, COLOUR.cube)
  )
  cube.userData.gizmo = 'scale'
  scale.add(cube)

  parts.move = move
  parts.rotate = rotate
  parts.scale = scale
  group.add(move, rotate, scale)

  return {
    group,
    parts,
    raycaster: new THREE.Raycaster()
  }
}

/** An unlit, always-on-top material: gizmos must read over any wall. */
function basic(THREE, colour, opacity = 1) {
  return new THREE.MeshBasicMaterial({
    color: colour,
    transparent: opacity < 1,
    opacity,
    depthTest: false,
    depthWrite: false
  })
}

/** One axis arrow: a shaft and a cone, pointing along the given unit axis. */
function arrow(THREE, axis, colour) {
  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(0.025, 0.025, 0.7, 8),
    basic(THREE, colour)
  )
  const tip = new THREE.Mesh(
    new THREE.ConeGeometry(0.07, 0.18, 12),
    basic(THREE, colour)
  )
  const group = new THREE.Group()
  group.add(shaft, tip)
  group.userData.gizmo = axisName(axis)

  // Cylinders grow along +Y and cones point along +Y; turn both onto the axis.
  const angle = axisToQuaternion(THREE, axis)
  shaft.quaternion.copy(angle)
  tip.quaternion.copy(angle)
  // Shaft: -0.35 to +0.35 along the axis; cone beyond it.
  shaft.position.copy(axisVec(THREE, axis).multiplyScalar(0.35))
  tip.position.copy(axisVec(THREE, axis).multiplyScalar(0.8))

  for (const node of [shaft, tip]) {
    node.userData.gizmo = axisName(axis)
    node.frustumCulled = false
  }
  return group
}

/** A translucent plane square for dragging in one world plane. */
function plane(THREE, name, colour) {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(0.5, 0.5),
    basic(THREE, colour, 0.35)
  )
  mesh.material.side = THREE.DoubleSide   // pickable from either face
  mesh.userData.gizmo = name
  mesh.frustumCulled = false
  if (name === 'xy') { /* default: faces +Z, correct */ }
  if (name === 'xz') mesh.rotation.x = Math.PI / 2
  if (name === 'yz') mesh.rotation.y = Math.PI / 2
  return mesh
}

const AXIS = {
  x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1]
}
const axisName = a => a[0] ? 'x' : (a[1] ? 'y' : 'z')
const axisVec = (THREE, a) => new THREE.Vector3(a[0], a[1], a[2])
const axisToQuaternion = (THREE, a) =>
  new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), axisVec(THREE, a))

// ------------------------------------------------------------------ picking
function hitGizmo(renderer, gizmo, p) {
  // Only the current mode's group is pickable — the hidden rotate ring in move
  // mode is invisible, so it must not be grab-able either.
  const target = gizmo.parts[state.mode]
  if (!target) return null
  gizmo.raycaster.ray.copy(renderer.ray(p.x, p.y))
  const hits = gizmo.raycaster.intersectObjects([target], true)
  if (!hits.length) return null
  let node = hits[0].object
  while (node && !node.userData.gizmo) node = node.parent
  if (!node?.userData.gizmo) return null

  const kind = node.userData.gizmo
  if (kind === 'x' || kind === 'y' || kind === 'z') return { kind: 'axis', axis: kind }
  if (kind === 'xy' || kind === 'xz' || kind === 'yz') return { kind: 'plane', plane: kind }
  if (kind === 'free') return { kind: 'free' }
  if (kind === 'rotate') return { kind: 'rotate' }
  if (kind === 'scale') return { kind: 'scale' }
  return null
}

// ------------------------------------------------------------------ dragging
function startDrag(context, renderer, part, p) {
  const pivot = centroid(context.selection)
  const ray = () => renderer.ray(p.x, p.y)
  const start = { kind: part.kind, pivot, moved: false, meta: false }

  if (part.kind === 'axis') {
    start.axis = AXIS[part.axis]
    start.t0 = axisT(ray(), pivot, AXIS[part.axis])
    start.orig = context.selection.map(e => ({ id: e.id, x: e.x, y: e.y, z: e.z || 0 }))
  }
  if (part.kind === 'plane') {
    start.normal = PLANE_NORMAL[part.plane]
    start.q0 = hitPlane(ray(), pivot, PLANE_NORMAL[part.plane])
    start.orig = context.selection.map(e => ({ id: e.id, x: e.x, y: e.y, z: e.z || 0 }))
  }
  if (part.kind === 'free') {
    start.normal = cameraForward(context.view)
    start.q0 = hitPlane(ray(), pivot, start.normal)
    start.orig = context.selection.map(e => ({ id: e.id, x: e.x, y: e.y, z: e.z || 0 }))
  }
  if (part.kind === 'rotate') {
    start.q0 = hitPlane(ray(), pivot, [0, 1, 0])
    start.orig = context.selection.map(e => ({ id: e.id, x: e.x, y: e.y, z: e.z || 0, r: e.rotation || 0 }))
  }
  if (part.kind === 'scale') {
    start.normal = cameraForward(context.view)
    start.q0 = hitPlane(ray(), pivot, start.normal)
    start.d0 = start.q0 ? dist(start.q0, pivot) : 1
    start.orig = context.selection.map(e => ({ id: e.id, x: e.x, y: e.y, z: e.z || 0, s: e.scale ?? 1 }))
  }

  state.drag = start
}

function dragMove(context, renderer, p, event) {
  const drag = state.drag
  if (!drag) return
  const ray = renderer.ray(p.x, p.y)
  const meta = event?.metaKey || event?.ctrlKey || false
  const shift = event?.shiftKey || false

  if (drag.kind === 'axis') {
    const t = axisT(ray, drag.pivot, drag.axis)
    const delta = (t - drag.t0)
    drag.moved ||= Math.abs(delta) > 1e-6
    forEachSelected(context, drag.orig, (entity, original) => applyMove(entity, {
      x: original.x + drag.axis[0] * delta,
      y: original.y + drag.axis[1] * delta,
      z: original.z + drag.axis[2] * delta
    }, meta))
    return
  }

  if (drag.kind === 'plane' || drag.kind === 'free') {
    const q = hitPlane(ray, drag.pivot, drag.normal)
    if (!q || !drag.q0) return
    const dx = q.x - drag.q0.x
    const dy = q.y - drag.q0.y
    const dz = q.z - drag.q0.z
    drag.moved ||= (Math.abs(dx) + Math.abs(dy) + Math.abs(dz)) > 1e-6
    forEachSelected(context, drag.orig, (entity, original) => applyMove(entity, {
      x: original.x + dx,
      y: original.y + dy,
      z: original.z + dz
    }, meta))
    return
  }

  if (drag.kind === 'rotate') {
    const q = hitPlane(ray, drag.pivot, [0, 1, 0])
    if (!q || !drag.q0) return
    const a0 = Math.atan2(drag.q0.x - drag.pivot.x, drag.q0.z - drag.pivot.z)
    const a1 = Math.atan2(q.x - drag.pivot.x, q.z - drag.pivot.z)
    let deg = (a1 - a0) * 180 / Math.PI
    if (!meta && shift) deg = Math.round(deg / ROTATE_SNAP) * ROTATE_SNAP
    drag.moved ||= Math.abs(deg) > 1e-4
    // Each entity orbits the pivot AND turns by the same amount, so a group
    // rotates as one thing rather than spinning in place.
    const c = Math.cos(a1 - a0), s = Math.sin(a1 - a0)
    forEachSelected(context, drag.orig, (entity, original) => {
      const vx = original.x - drag.pivot.x, vz = original.z - drag.pivot.z
      entity.x = drag.pivot.x + vx * c - vz * s
      entity.z = drag.pivot.z + vx * s + vz * c
      entity.y = original.y
      // The same folding the engine uses everywhere: -10 and 350 are the same
      // facing, and one of them is the readable one.
      const n = ((original.r + deg) % 360 + 360) % 360
      entity.rotation = n > 180 ? n - 360 : n
    })
    return
  }

  if (drag.kind === 'scale') {
    const q = hitPlane(ray, drag.pivot, drag.normal)
    if (!q) return
    const d = dist(q, drag.pivot)
    let factor = drag.d0 > 0 ? d / drag.d0 : 1
    if (!meta) factor = Math.round(factor / SCALE_SNAP) * SCALE_SNAP
    factor = Math.max(0.05, factor)
    drag.moved ||= Math.abs(factor - 1) > 1e-4
    forEachSelected(context, drag.orig, (entity, original) => {
      entity.x = drag.pivot.x + (original.x - drag.pivot.x) * factor
      entity.y = drag.pivot.y + (original.y - drag.pivot.y) * factor
      entity.z = drag.pivot.z + (original.z - drag.pivot.z) * factor
      entity.scale = Math.max(0.05, (original.s ?? 1) * factor)
    })
  }
}

/**
 * Run one drag action for every entity the selection started with.
 *
 * Every kind of drag walks the same list and skips what the world no longer
 * has, which is what the four copies of this loop used to say separately.
 */
function forEachSelected(context, originals, apply) {
  for (const original of originals) {
    const entity = context.world.byId(original.id)
    if (entity) apply(entity, original)
  }
}

function applyMove(e, next, meta) {
  e.x = meta ? next.x : Math.round(next.x / GRID) * GRID
  e.y = meta ? next.y : Math.round(next.y / GRID) * GRID
  e.z = meta ? next.z : Math.round(next.z / GRID) * GRID
}

// ------------------------------------------------------------------ geometry
const PLANE_NORMAL = {
  xy: [0, 0, 1],    // dragging in X and Y — normal is Z
  xz: [0, 1, 0],    // dragging in X and Z — normal is Y
  yz: [1, 0, 0]     // dragging in Y and Z — normal is X
}

/**
 * The camera's facing, from the view's own angles — the same convention the
 * game camera documents: yaw turns left around +Y, pitch looks up around +X,
 * and at 0/0 the eye faces -Z.
 */
function cameraForward(view) {
  const yaw = view.yaw || 0
  const pitch = view.pitch || 0
  return [
    -Math.sin(yaw) * Math.cos(pitch),
    Math.sin(pitch),
    -Math.cos(yaw) * Math.cos(pitch)
  ]
}

/** Where the ray meets the plane through `origin` with the given normal. */
function hitPlane(ray, origin, normal) {
  const [nx, ny, nz] = normal
  const denom = ray.direction.x * nx + ray.direction.y * ny + ray.direction.z * nz
  if (Math.abs(denom) < 1e-8) return null
  const t = ((origin.x - ray.origin.x) * nx + (origin.y - ray.origin.y) * ny + (origin.z - ray.origin.z) * nz) / denom
  if (t < 0) return null
  return {
    x: ray.origin.x + ray.direction.x * t,
    y: ray.origin.y + ray.direction.y * t,
    z: ray.origin.z + ray.direction.z * t
  }
}

/**
 * The parameter along the axis line where it comes closest to the ray —
 * the scalar a drag reports, so moving the mouse back and forth along an
 * axis reads as moving the entity back and forth along it.
 */
function axisT(ray, pivot, axis) {
  const [ax, ay, az] = axis
  const c = ray.direction.x * ax + ray.direction.y * ay + ray.direction.z * az
  const w = {
    x: ray.origin.x - pivot.x,
    y: ray.origin.y - pivot.y,
    z: ray.origin.z - pivot.z
  }
  const wA = w.x * ax + w.y * ay + w.z * az
  const wD = w.x * ray.direction.x + w.y * ray.direction.y + w.z * ray.direction.z
  const denom = 1 - c * c
  if (Math.abs(denom) < 1e-6) return wA      // looking straight down the axis
  return (wA - c * wD) / denom
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)

// ------------------------------------------------------------------ sizing
/** The selection's middle, in world metres. */
function centroid(list) {
  if (!list.length) return { x: 0, y: 0, z: 0 }
  let x = 0, y = 0, z = 0
  for (const e of list) { x += e.x; y += e.y; z += e.z || 0 }
  return { x: x / list.length, y: y / list.length, z: z / list.length }
}

/** Gizmo size: a slice of the selection's own extent, so a wall's gizmo is bigger than a crate's. */
function gizmoSize(context, list) {
  let max = 0
  for (const e of list) {
    const { w, h } = context.renderer?.bounds?.(e) || { w: 1, h: 1 }
    max = Math.max(max, w, h)
  }
  return Math.min(4, Math.max(0.5, max * 0.35))
}
