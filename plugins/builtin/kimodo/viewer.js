/**
 * Kimodo take viewer: one model playing one clip in a small 3D view of its own.
 *
 * It is not the game viewport. The model stands alone on a grid, seen from the
 * side, so a take is judged on the body alone, with no level, camera rule or
 * gear in the way. Drag turns the view about the model.
 *
 * A clip that plays once holds its last frame for HOLD_SECONDS and starts
 * again, so an attack can be watched over and over.
 *
 *   const viewer = mountViewer(stage)
 *   viewer.show({ model: 'models/hero.glb', clip })   // clip as widenClip returns it
 *   viewer.edit(session)                              // the designer: see below
 *   await viewer.thumbnail({ model, clip })           // a still of the take's middle, as a PNG data URL
 *   viewer.dispose()
 *
 * In edit mode the panel poses the model and the viewer draws it with a
 * handle on each limb a person can move. `session` is
 * `{ model, poseAt(seconds), handles(), clock(), grab(handle), move(handle, point), drop(handle, point), hold }`:
 * `poseAt` answers a Rig Animation pose (node -> turn, or turn and place),
 * `handles()` answers `[{ handle, point, look, shape, joint? }]` with `look`
 * 'selected', 'keyed' or 'free', `shape` 'sphere', 'ring' (a pelvis ring,
 * lying flat) or 'pole' (an elbow or knee target, joined by a line to
 * `joint`), and points are model space. A handle is dragged in the
 * plane that faces the camera; anywhere else a drag turns the view. `hold`,
 * `{ model, node, position, rotation }` or null, is an item shown in that
 * node, in its space in metres and radians. `guides(seconds)`, if given,
 * answers `[{ handle, keys, path, target }]` (designer.js `guidesAt`): the
 * viewer draws the path and keys, and a ring at `target` joined to the handle,
 * so a key the limb cannot reach shows as a gap. `body(seconds)`, if given,
 * answers `{ target: { hips, chest, head, look }, reached: { hips, chest,
 * head } }` or null (body-rig.js): the viewer draws the body keys as a white
 * line through hips, chest and head with a look arrow, and the body as it is
 * now as a blue line beside it.
 */
import * as THREE from 'three/webgpu'
import { cachedModel, cloneModel } from '../../../engine/render/model-cache.js'
import { framesAt, mixInto } from '../rig-animation/sample.js'

const HOLD_SECONDS = 0.6

/** A handle's colour by how it looks: picked, keyed, or not yet keyed. */
const HANDLE_COLOURS = { selected: '#ffd84a', keyed: '#ff8a3d', free: '#4ad8ff' }
/** Guide colours: the keys and the path between them, and where a handle is asked to be now. */
const GUIDE_COLOURS = { path: '#ff8a3d', key: '#ff8a3d', target: '#ffffff' }
/** Body line colours: where the body keys ask the spine to be, and where it is. */
const BODY_COLOURS = { target: '#ffffff', reached: '#4ad8ff' }
const TURN_PER_PIXEL = 0.01

/** Each handle shape's geometry, made when a handle first needs it. */
const HANDLE_SHAPES = {
  sphere: () => new THREE.SphereGeometry(0.045, 16, 12),
  ring: () => new THREE.TorusGeometry(0.17, 0.016, 8, 48).rotateX(Math.PI / 2),
  pole: () => new THREE.OctahedronGeometry(0.04)
}

/** A node name as the glTF loader stores it: dots, colons, slashes and brackets dropped. */
const plainName = name => name.replace(/[[\].:/]/g, '')

/** A thumbnail's side in pixels. */
const THUMBNAIL_SIZE = 128

/** Every named node of a model, by its plain name. */
function nodesOf(model) {
  const nodes = new Map()
  model.traverse(node => {
    if (node.name) nodes.set(plainName(node.name), node)
  })
  return nodes
}

/** Pose `nodes` with `clip` at `seconds` into it. */
function poseNodes(nodes, clip, seconds) {
  const quaternion = [0, 0, 0, 1]
  const { first, second, blend } = framesAt(clip, seconds)
  for (let index = 0; index < clip.nodes.length; index++) {
    const node = nodes.get(plainName(clip.nodes[index]))
    if (!node) continue
    mixInto(quaternion, clip.rotations[first], clip.rotations[second], index * 4, blend)
    node.quaternion.fromArray(quaternion)
  }
  for (const [name, frames] of Object.entries(clip.positions || {})) nodes.get(plainName(name))?.position.fromArray(frames[first])
}

/** A model file, loaded once and cloned, as a promise. */
const loadedModel = file => new Promise((resolve, reject) => cachedModel(file, loaded => resolve(cloneModel(loaded)), reject))

/**
 * RGBA read back from a render target as a PNG data URL: its rows put top
 * first, and each channel turned from linear light to sRGB, which the canvas
 * does for the view and a render target does not.
 */
function pngOf(pixels, size, isBottomFirst) {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const image = canvas.getContext('2d').createImageData(size, size)
  for (let row = 0; row < size; row++) {
    const from = (isBottomFirst ? size - 1 - row : row) * size * 4
    for (let offset = 0; offset < size * 4; offset++) {
      const value = pixels[from + offset]
      image.data[row * size * 4 + offset] = offset % 4 === 3 ? 255 : Math.round(255 * (value / 255) ** (1 / 2.2))
    }
  }
  canvas.getContext('2d').putImageData(image, 0, 0)
  return canvas.toDataURL('image/png')
}

/** Mount a view in `stage`, an element the panel keeps between draws. */
export function mountViewer(stage) {
  const canvas = document.createElement('canvas')
  canvas.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;cursor:grab'
  stage.append(canvas)

  const renderer = new THREE.WebGPURenderer({ canvas, antialias: true })
  const scene = new THREE.Scene()
  scene.background = new THREE.Color('#10262e')
  scene.add(new THREE.HemisphereLight('#cfe6ee', '#1a2a30', 1.6))
  const sun = new THREE.DirectionalLight('#ffffff', 2.2)
  sun.position.set(-2, 4, 3)
  scene.add(sun)
  scene.add(new THREE.GridHelper(6, 12, '#2f6f7f', '#1d4550'))
  const camera = new THREE.PerspectiveCamera(35, 1, 0.05, 50)

  const view = {
    model: null,
    modelFile: null,
    clip: null,
    nodes: new Map(),
    startedAt: 0,
    heldAt: null,
    turn: Math.PI / 2,
    zoom: 1,
    height: 1.8,
    lift: 0,
    isReady: false,
    session: null
  }
  const handleMeshes = new Map()
  const poleLines = new Map()
  const guideParts = { signature: '', paths: new THREE.Group(), targets: new Map() }
  scene.add(guideParts.paths)
  const held = { file: null, mesh: null, node: null }

  function placeCamera() {
    // Far enough that the whole body and a margin fit, in a tall view as well as a wide one.
    const halfView = Math.tan((camera.fov * Math.PI) / 360)
    const distance = (view.height * 0.7) / halfView / Math.min(camera.aspect, 1) / view.zoom
    // Zoomed in, the view looks at the chest, where the hands work.
    const lookHeight = view.height * (0.72 - 0.22 / view.zoom)
    camera.position.set(Math.sin(view.turn) * distance, lookHeight + view.height * 0.1, Math.cos(view.turn) * distance)
    camera.lookAt(0, lookHeight, 0)
  }

  function fit() {
    const width = stage.clientWidth || 1
    const height = stage.clientHeight || 1
    renderer.setSize(width, height, false)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
  }

  function pose(seconds) {
    const clip = view.clip
    if (!clip || !view.model) return
    const length = clip.count / clip.framesPerSecond
    // A clip that plays once is watched on repeat, with a pause on its last frame.
    poseNodes(view.nodes, clip, clip.loop ? seconds : seconds % (length + HOLD_SECONDS))
  }

  /** A still of `clip` on `model` at its middle, seen from the front and a little to the side. */
  async function thumbnailOf({ model, clip }) {
    if (!view.isReady) await renderer.init()
    const figure = await loadedModel(model)
    poseNodes(nodesOf(figure), clip, clip.count / clip.framesPerSecond / 2)
    figure.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(figure)
    const middle = box.getCenter(new THREE.Vector3())
    const height = Math.max(box.max.y - box.min.y, 0.2)
    const studio = new THREE.Scene()
    studio.background = scene.background
    studio.add(new THREE.HemisphereLight('#cfe6ee', '#1a2a30', 1.6), sun.clone(), figure)
    const lens = new THREE.PerspectiveCamera(35, 1, 0.05, 50)
    lens.position.set(middle.x + height * 1.1, middle.y + height * 0.25, middle.z + height * 2.2)
    lens.lookAt(middle)
    const target = new THREE.RenderTarget(THUMBNAIL_SIZE, THUMBNAIL_SIZE)
    renderer.setRenderTarget(target)
    renderer.render(studio, lens)
    renderer.setRenderTarget(null)
    const pixels = await renderer.readRenderTargetPixelsAsync(target, 0, 0, THUMBNAIL_SIZE, THUMBNAIL_SIZE)
    target.dispose()
    // WebGL reads rows from the bottom; WebGPU from the top.
    return pngOf(pixels, THUMBNAIL_SIZE, renderer.backend.isWebGLBackend === true)
  }

  /** Write a Rig Animation pose onto the model's nodes. */
  function applyPose(posed) {
    for (const [name, value] of Object.entries(posed ?? {})) {
      const node = view.nodes.get(plainName(name))
      if (!node) continue
      node.quaternion.fromArray(value)
      if (value.length === 7) node.position.fromArray(value, 4)
    }
  }

  /** A handle's mesh in its shape, made once; a pole target's comes with the line to its joint. */
  function handleMeshOf(handle, shape) {
    if (handleMeshes.has(handle)) return handleMeshes.get(handle)
    const mesh = new THREE.Mesh(
      HANDLE_SHAPES[shape](),
      new THREE.MeshBasicMaterial({ depthTest: false, transparent: true })
    )
    mesh.renderOrder = 10
    mesh.userData.handle = handle
    handleMeshes.set(handle, mesh)
    scene.add(mesh)
    if (shape === 'pole') poleLines.set(handle, overlayLine(HANDLE_COLOURS.free))
    return mesh
  }

  /** One mesh per handle, placed and coloured as the session says. */
  function drawHandles(handles) {
    const shown = new Set()
    for (const { handle, point, look, shape = 'sphere', joint } of handles) {
      shown.add(handle)
      const mesh = handleMeshOf(handle, shape)
      mesh.material.color.set(HANDLE_COLOURS[look])
      mesh.position.set(point[0], point[1] + view.lift, point[2])
      if (joint) poleLines.get(handle)?.geometry.setFromPoints([lifted(point), lifted(joint)])
    }
    for (const [handle, mesh] of handleMeshes) mesh.visible = shown.has(handle)
    for (const [handle, line] of poleLines) line.visible = shown.has(handle)
  }

  /** A model-space point in the view, where the model stands lifted onto the grid. */
  const lifted = point => new THREE.Vector3(point[0], point[1] + view.lift, point[2])

  /** A material drawn over the body, so a guide behind an arm still shows. */
  const overlayMaterial = (kind, colour, opacity = 1) =>
    new kind({ color: colour, depthTest: false, transparent: true, opacity, side: THREE.DoubleSide })

  /** Rebuild each keyed handle's path line and key cubes; they change only when the keys do. */
  function buildGuidePaths(guides) {
    for (const child of [...guideParts.paths.children]) {
      child.geometry.dispose()
      child.removeFromParent()
    }
    for (const guide of guides) {
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(guide.path.map(lifted)),
        overlayMaterial(THREE.LineBasicMaterial, GUIDE_COLOURS.path, 0.6)
      )
      line.renderOrder = 9
      guideParts.paths.add(line)
      for (const key of guide.keys) {
        const cube = new THREE.Mesh(
          new THREE.BoxGeometry(0.03, 0.03, 0.03),
          overlayMaterial(THREE.MeshBasicMaterial, GUIDE_COLOURS.key)
        )
        cube.position.copy(lifted(key))
        cube.renderOrder = 9
        guideParts.paths.add(cube)
      }
    }
  }

  /** A ring where a handle is asked to be now, and a line from where its limb reached. */
  function targetMarkOf(handle) {
    if (guideParts.targets.has(handle)) return guideParts.targets.get(handle)
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.05, 0.065, 24),
      overlayMaterial(THREE.MeshBasicMaterial, GUIDE_COLOURS.target)
    )
    const link = new THREE.Line(
      new THREE.BufferGeometry(),
      overlayMaterial(THREE.LineBasicMaterial, GUIDE_COLOURS.target, 0.8)
    )
    ring.renderOrder = 11
    link.renderOrder = 11
    scene.add(ring, link)
    const mark = { ring, link }
    guideParts.targets.set(handle, mark)
    return mark
  }

  /** Draw the session's guides at `seconds`; `handles` are where the limbs reached. */
  function drawGuides(session, seconds, handles) {
    const guides = session.guides?.(seconds) ?? []
    const signature = JSON.stringify(guides.map(guide => [guide.keys, guide.path.at(-1), view.lift]))
    if (signature !== guideParts.signature) {
      guideParts.signature = signature
      buildGuidePaths(guides)
    }
    const shown = new Set()
    for (const guide of guides) {
      const reached = handles.find(entry => entry.handle === guide.handle)
      if (!guide.target || !reached) continue
      shown.add(guide.handle)
      const { ring, link } = targetMarkOf(guide.handle)
      ring.position.copy(lifted(guide.target))
      ring.lookAt(camera.position)
      link.geometry.setFromPoints([lifted(reached.point), lifted(guide.target)])
    }
    for (const [handle, { ring, link }] of guideParts.targets) {
      ring.visible = shown.has(handle)
      link.visible = shown.has(handle)
    }
  }

  /** A line drawn over the body, made once and moved each frame. */
  function overlayLine(colour) {
    const line = new THREE.Line(new THREE.BufferGeometry(), overlayMaterial(THREE.LineBasicMaterial, colour))
    line.renderOrder = 12
    scene.add(line)
    return line
  }

  const bodyLines = {
    target: overlayLine(BODY_COLOURS.target),
    look: overlayLine(BODY_COLOURS.target),
    reached: overlayLine(BODY_COLOURS.reached)
  }

  /** Draw the session's body keys and the body as it is now, or hide both. */
  function drawBody(session, seconds) {
    const body = session?.body?.(seconds)
    for (const line of Object.values(bodyLines)) line.visible = Boolean(body)
    if (!body) return
    const { target, reached } = body
    bodyLines.target.geometry.setFromPoints([target.hips, target.chest, target.head].map(lifted))
    bodyLines.look.geometry.setFromPoints(target.look.map(lifted))
    bodyLines.reached.geometry.setFromPoints([reached.hips, reached.chest, reached.head].map(lifted))
  }

  function hideGuides() {
    guideParts.signature = ''
    buildGuidePaths([])
    for (const { ring, link } of guideParts.targets.values()) {
      ring.visible = false
      link.visible = false
    }
  }

  /** Show the session's held item in its node, or nothing. */
  function holdItem(hold) {
    if (held.file !== (hold?.model ?? null)) {
      held.mesh?.removeFromParent()
      held.mesh = null
      held.file = hold?.model ?? null
      if (hold)
        cachedModel(
          hold.model,
          loaded => {
            if (held.file === hold.model) held.mesh = cloneModel(loaded)
          },
          () => {
            held.file = null
          }
        )
    }
    const node = hold && view.nodes.get(plainName(hold.node))
    if (!held.mesh || !node) return
    if (held.mesh.parent !== node) node.add(held.mesh)
    // The hand bone may be scaled (a model in centimetres); the item is given in metres.
    const scale = node.getWorldScale(new THREE.Vector3()).x || 1
    held.mesh.scale.setScalar(1 / scale)
    held.mesh.position.set(...hold.position.map(value => value / scale))
    // A hold gives its turn as a rotation [x, y, z] (the design board) or a quaternion `turn` (the hold board).
    if (hold.turn) held.mesh.quaternion.fromArray(hold.turn)
    else held.mesh.rotation.set(...hold.rotation)
  }

  function frame(time) {
    if (!view.isReady) return
    const session = view.session
    if (session) {
      const seconds = session.clock()
      applyPose(session.poseAt(seconds))
      const handles = session.handles()
      drawHandles(handles)
      drawGuides(session, seconds, handles)
      drawBody(session, seconds)
      holdItem(session.hold)
    } else {
      pose(view.heldAt ?? time / 1000 - view.startedAt)
    }
    placeCamera()
    renderer.render(scene, camera)
  }

  function useModel(file) {
    if (view.modelFile === file) return
    view.modelFile = file
    if (view.model) scene.remove(view.model)
    view.model = null
    cachedModel(
      file,
      loaded => {
        if (view.modelFile !== file) return
        const model = cloneModel(loaded)
        view.nodes = new Map()
        model.traverse(node => {
          if (node.name) view.nodes.set(plainName(node.name), node)
        })
        const box = new THREE.Box3().setFromObject(model)
        // Stand it on the grid, whatever its origin.
        model.position.y -= box.min.y
        view.lift = -box.min.y
        view.height = Math.max(box.max.y - box.min.y, 0.2)
        view.model = model
        scene.add(model)
      },
      () => {
        view.modelFile = null
      }
    )
  }

  const raycaster = new THREE.Raycaster()
  const pointer = new THREE.Vector2()
  /** The ray under the pointer. */
  function aim(event) {
    const box = canvas.getBoundingClientRect()
    pointer.set(((event.clientX - box.left) / box.width) * 2 - 1, -((event.clientY - box.top) / box.height) * 2 + 1)
    raycaster.setFromCamera(pointer, camera)
    return raycaster
  }
  /** The model-space point under the pointer on the plane `drag.plane`. */
  function pointOnPlane(event, plane) {
    const hit = aim(event).ray.intersectPlane(plane, new THREE.Vector3())
    return hit && [hit.x, hit.y - view.lift, hit.z]
  }

  /** Where the dragged handle is now: the pointer on the drag's plane, plus where on the handle it was grabbed. */
  function handlePointOf(event, grab) {
    const point = pointOnPlane(event, grab.plane)
    return point && point.map((value, axis) => value + grab.offset[axis])
  }

  let drag = null
  canvas.addEventListener(
    'wheel',
    event => {
      event.preventDefault()
      view.zoom = Math.max(1, Math.min(3, view.zoom * Math.exp(-event.deltaY * 0.001)))
    },
    { passive: false }
  )
  canvas.addEventListener('pointerdown', event => {
    canvas.setPointerCapture(event.pointerId)
    const meshes = [...handleMeshes.values()].filter(mesh => mesh.visible)
    const hit = view.session && aim(event).intersectObjects(meshes)[0]
    if (!hit) {
      drag = { turnFrom: event.clientX }
      return
    }
    const handle = hit.object.userData.handle
    const facing = camera.getWorldDirection(new THREE.Vector3())
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(facing, hit.object.position)
    // Kept so a ring grabbed at its edge moves from where it was, not jumps its centre to the pointer.
    const grabbed = pointOnPlane(event, plane) ?? [0, 0, 0]
    const offset = [0, 1, 2].map(axis => hit.object.position.getComponent(axis) - (axis === 1 ? view.lift : 0) - grabbed[axis])
    drag = { handle, plane, offset }
    view.session.grab(handle)
  })
  canvas.addEventListener('pointermove', event => {
    if (!drag) return
    if (drag.handle) {
      const point = handlePointOf(event, drag)
      if (point) view.session?.move(drag.handle, point)
      return
    }
    view.turn -= (event.clientX - drag.turnFrom) * TURN_PER_PIXEL
    drag.turnFrom = event.clientX
  })
  canvas.addEventListener('pointerup', event => {
    if (drag?.handle) {
      const point = handlePointOf(event, drag)
      if (point) view.session?.drop(drag.handle, point)
    }
    drag = null
  })

  const resize = new ResizeObserver(fit)
  resize.observe(stage)
  renderer.init().then(() => {
    fit()
    view.isReady = true
    renderer.setAnimationLoop(frame)
  })

  return {
    /** Play `clip` on `model` from its start, or hold it still at `at` seconds. */
    show({ model, clip, at = null }) {
      this.stopEditing()
      useModel(model)
      view.clip = clip
      view.heldAt = at
      view.startedAt = performance.now() / 1000
    },
    /** Pose and draw the designer's session instead of playing a take. */
    edit(session) {
      useModel(session.model)
      view.session = session
    },
    stopEditing() {
      view.session = null
      for (const mesh of handleMeshes.values()) mesh.visible = false
      for (const line of poleLines.values()) line.visible = false
      hideGuides()
      drawBody(null)
      holdItem(null)
    },
    thumbnail: thumbnailOf,
    dispose() {
      resize.disconnect()
      renderer.setAnimationLoop(null)
      renderer.dispose()
      canvas.remove()
    }
  }
}
