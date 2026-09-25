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
 *   viewer.dispose()
 */
import * as THREE from 'three/webgpu'
import { cachedModel, cloneModel } from '../../../engine/render/model-cache.js'
import { framesAt, mixInto } from '../rig-animation/sample.js'

const HOLD_SECONDS = 0.6
const TURN_PER_PIXEL = 0.01

/** A node name as the glTF loader stores it: dots, colons, slashes and brackets dropped. */
const plainName = name => name.replace(/[[\].:/]/g, '')

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

  const view = { model: null, modelFile: null, clip: null, nodes: new Map(), startedAt: 0, turn: Math.PI / 2, height: 1.8, isReady: false }
  const quaternion = [0, 0, 0, 1]

  function placeCamera() {
    // Far enough that the whole body and a margin fit, in a tall view as well as a wide one.
    const halfView = Math.tan((camera.fov * Math.PI) / 360)
    const distance = (view.height * 0.7) / halfView / Math.min(camera.aspect, 1)
    camera.position.set(Math.sin(view.turn) * distance, view.height * 0.6, Math.cos(view.turn) * distance)
    camera.lookAt(0, view.height * 0.5, 0)
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
    const at = clip.loop ? seconds : seconds % (length + HOLD_SECONDS)
    const { first, second, blend } = framesAt(clip, at)
    for (let index = 0; index < clip.nodes.length; index++) {
      const node = view.nodes.get(plainName(clip.nodes[index]))
      if (!node) continue
      mixInto(quaternion, clip.rotations[first], clip.rotations[second], index * 4, blend)
      node.quaternion.fromArray(quaternion)
    }
    for (const [name, frames] of Object.entries(clip.positions || {})) {
      view.nodes.get(plainName(name))?.position.fromArray(frames[first])
    }
  }

  function frame(time) {
    if (!view.isReady) return
    pose(time / 1000 - view.startedAt)
    placeCamera()
    renderer.render(scene, camera)
  }

  function useModel(file) {
    if (view.modelFile === file) return
    view.modelFile = file
    if (view.model) scene.remove(view.model)
    view.model = null
    cachedModel(file, loaded => {
      if (view.modelFile !== file) return
      const model = cloneModel(loaded)
      view.nodes = new Map()
      model.traverse(node => { if (node.name) view.nodes.set(plainName(node.name), node) })
      const box = new THREE.Box3().setFromObject(model)
      // Stand it on the grid, whatever its origin.
      model.position.y -= box.min.y
      view.height = Math.max(box.max.y - box.min.y, 0.2)
      view.model = model
      scene.add(model)
    }, () => { view.modelFile = null })
  }

  let drag = null
  canvas.addEventListener('pointerdown', event => { drag = event.clientX; canvas.setPointerCapture(event.pointerId) })
  canvas.addEventListener('pointermove', event => {
    if (drag === null) return
    view.turn -= (event.clientX - drag) * TURN_PER_PIXEL
    drag = event.clientX
  })
  canvas.addEventListener('pointerup', () => { drag = null })

  const resize = new ResizeObserver(fit)
  resize.observe(stage)
  renderer.init().then(() => {
    fit()
    view.isReady = true
    renderer.setAnimationLoop(frame)
  })

  return {
    /** Play `clip` on `model` from its start. */
    show({ model, clip }) {
      useModel(model)
      view.clip = clip
      view.startedAt = performance.now() / 1000
    },
    dispose() {
      resize.disconnect()
      renderer.setAnimationLoop(null)
      renderer.dispose()
      canvas.remove()
    }
  }
}
