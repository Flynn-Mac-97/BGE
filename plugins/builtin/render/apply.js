/**
 * Put Render settings onto three's renderer and scene.
 *
 * Browser only: every function returns quietly when there is no renderer, so a
 * headless world reports the settings without drawing them.
 *
 * Nothing here is written from scratch. Tone mapping, the studio environment,
 * the HDR and EXR loaders and the environment filter all ship in `three`.
 */

/** Tone mapping names, as three's constants. Read off the module at apply time. */
const TONE = {
  agx: 'AgXToneMapping',
  neutral: 'NeutralToneMapping',
  aces: 'ACESFilmicToneMapping',
  reinhard: 'ReinhardToneMapping',
  none: 'NoToneMapping'
}

/**
 * Shadow edges, as a three shadow map type and a blur radius in texels.
 *
 * Soft edges use variance maps, not a wide PCF radius: the node renderer's PCF
 * takes five rotated samples, so a wide radius shows as grain along the edge.
 */
const SHADOW = {
  soft: { type: 'VSMShadowMap', radius: 4 },
  smooth: { type: 'VSMShadowMap', radius: 9 },
  sharp: { type: 'PCFShadowMap', radius: 1 }
}

/** The key the renderer reads at start-up to choose its backend. */
const BACKEND_KEY = 'engine.forceWebGL'

/** Built environments, by name, so switching back to one does not rebuild it. */
const environments = new Map()

/** three's renderer and scene, or null when nothing draws. */
const parts = context => {
  const renderer = context.renderer?.threeRenderer
  return renderer ? { renderer, scene: context.renderer.scene } : null
}

/** Force every material to rebuild, because tone mapping and shadow type are compiled in. */
function recompile(scene) {
  scene.traverse(object => {
    const materials = Array.isArray(object.material) ? object.material : [object.material]
    for (const material of materials) if (material) material.needsUpdate = true
  })
}

/** Tone mapping and exposure. Returns whether anything changed. */
export function applyToneMapping(context, THREE, { toneMapping, exposure }) {
  const found = parts(context)
  if (!found) return false
  const wanted = THREE[TONE[toneMapping]] ?? THREE.NoToneMapping
  const changed = found.renderer.toneMapping !== wanted
  found.renderer.toneMapping = wanted
  found.renderer.toneMappingExposure = exposure
  if (changed) recompile(found.scene)
  return changed
}

/**
 * The environment texture for one setting, built once.
 *
 * `room` is three's RoomEnvironment. A path is an equirectangular .hdr or .exr
 * from the project's assets. Both are filtered for rough and smooth surfaces
 * the same way, so the level probe can draw either as its background.
 */
async function environmentFor(THREE, renderer, name) {
  if (environments.has(name)) return environments.get(name)
  let texture = null
  if (name === 'room') {
    const { RoomEnvironment } = await import('three/addons/environments/RoomEnvironment.js')
    const generator = new THREE.PMREMGenerator(renderer)
    texture = generator.fromScene(new RoomEnvironment(), 0.04).texture
  } else if (/\.(hdr|exr)$/i.test(name)) {
    const module = /\.exr$/i.test(name)
      ? await import('three/addons/loaders/EXRLoader.js')
      : await import('three/addons/loaders/HDRLoader.js')
    const Loader = module.EXRLoader || module.HDRLoader
    const path = name.replace(/^\/?project\//, '').replace(/^(?!assets\/)/, 'assets/')
    const photo = await new Loader().loadAsync(`/project/${path}`)
    photo.mapping = THREE.EquirectangularReflectionMapping
    texture = new THREE.PMREMGenerator(renderer).fromEquirectangular(photo).texture
  }
  environments.set(name, texture)
  return texture
}

/** Environment light and its strength. Leaves the background to the Skybox plugin. */
export async function applyEnvironment(context, THREE, { environment, environmentIntensity, environmentBlur }) {
  const found = parts(context)
  if (!found) return null
  const texture = environment === 'none' ? null : await environmentFor(THREE, found.renderer, environment)
  sky = texture
  blur = environmentBlur === 'blender' ? { THREE, TSL: await import('three/tsl'), ...(await import('./environment-blur.js')) } : null
  useEnvironment(found.scene, probe?.texture && texture ? probe.texture : texture)
  found.scene.environmentIntensity = environmentIntensity
  return texture ? environment : 'none'
}

/** The environment texture before any probe, and the last probe built from it. */
let sky = null
let probe = null

/** The Blender blur correction when it is on: three, TSL and environment-blur.js. */
let blur = null
const correctedNodes = new WeakMap()

/**
 * Light the scene from one filtered texture, blurred as `environmentBlur` says.
 * Every change of environment goes through here, so the correction follows
 * the sky and the room probe alike.
 */
function useEnvironment(scene, texture) {
  scene.environment = texture
  if (!texture || !blur) { scene.environmentNode = null; return }
  if (!correctedNodes.has(texture)) correctedNodes.set(texture, blur.correctedEnvironment(blur.THREE, blur.TSL, texture))
  scene.environmentNode = correctedNodes.get(texture)
}

/**
 * Where the probe is captured: the middle of every loaded model, at 1.5 m, or
 * the origin when there is none. Models are what a player looks at, so their
 * reflections matter most.
 */
function probePosition(THREE, scene) {
  const box = new THREE.Box3()
  scene.traverse(object => { if (object.userData?.model) box.expandByObject(object) })
  if (box.isEmpty()) return new THREE.Vector3(0, 1.5, 0)
  const centre = box.getCenter(new THREE.Vector3())
  return centre.setY(box.min.y + Math.min(1.5, box.max.y - box.min.y))
}

/**
 * One PMREM generator per renderer, kept for every capture.
 *
 * A generator owns its blur meshes and materials, and the renderer keeps a
 * record for each of them until they are disposed. A new generator per capture
 * left twenty of those records behind on every level load.
 */
const generators = new WeakMap()
function generatorFor(THREE, renderer) {
  if (!generators.has(renderer)) generators.set(renderer, new THREE.PMREMGenerator(renderer))
  return generators.get(renderer)
}

/**
 * Capture the level into the environment: walls, floor and lights, with the
 * sky seen past them.
 *
 * Environment light alone comes from every direction, through walls. A cloth
 * fold facing the floor then reflects bright sky, which reads as wet. Loaded
 * models are hidden during the capture, so a model never reflects itself.
 * Answers the capture time in milliseconds, or null when nothing was captured.
 */
export function captureProbe(context, THREE) {
  const found = parts(context)
  if (!found || !sky) return null
  const { renderer, scene } = found
  const started = performance.now()
  const hidden = []
  scene.traverse(object => { if (object.userData?.model && object.visible) { hidden.push(object); object.visible = false } })
  const background = scene.background
  if (!background?.isTexture) scene.background = sky
  useEnvironment(scene, sky)
  try {
    const next = generatorFor(THREE, renderer).fromScene(scene, 0, 0.1, 200, { position: probePosition(THREE, scene) })
    probe?.dispose()
    probe = next
  } finally {
    scene.background = background
    for (const object of hidden) object.visible = true
  }
  useEnvironment(scene, probe.texture)
  return Math.round(performance.now() - started)
}

/** Light the level from the sky alone again. */
export function dropProbe(context) {
  const found = parts(context)
  probe?.dispose()
  probe = null
  if (found && sky) useEnvironment(found.scene, sky)
}

/** The renderer's own readability values, kept the first time they are changed. */
let readabilityDefaults = null

/**
 * Switch the arcade readability aids: outline, ground oval and follow ring.
 * `on` puts back the renderer's own values, so a game's changes to them stand.
 */
export function applyReadability(context, { readability }) {
  const aids = context.renderer?.readability
  if (!aids) return
  readabilityDefaults ??= { keyline: aids.keyline, shadow: aids.shadow, ring: aids.ring }
  Object.assign(aids, readability === 'off' ? { keyline: 0, shadow: false, ring: false } : readabilityDefaults)
}

/** The shadow map type, set once per change. */
export function applyShadowType(context, THREE, { shadows }) {
  const found = parts(context)
  if (!found) return false
  const wanted = THREE[SHADOW[shadows].type]
  if (found.renderer.shadowMap.type === wanted) return false
  found.renderer.shadowMap.type = wanted
  recompile(found.scene)
  return true
}

/**
 * Blur and map size on every light that casts a shadow.
 *
 * Run again after lights change, because the Lights plugin sets its own size
 * when it builds a light. A light already at these values is left alone, so a
 * repeat costs one comparison per light.
 */
export function applyShadowQuality(context, { shadows, shadowSize }) {
  const found = parts(context)
  if (!found) return 0
  const radius = SHADOW[shadows].radius
  let touched = 0
  found.scene.traverse(object => {
    if (!object.isLight || !object.castShadow || !object.shadow) return
    const shadow = object.shadow
    if (shadow.radius === radius && shadow.mapSize.x === shadowSize) return
    shadow.radius = radius
    if (shadow.mapSize.x !== shadowSize) {
      shadow.mapSize.set(shadowSize, shadowSize)
      // A map is sized when it is made, so a new size needs a new map.
      shadow.map?.dispose?.()
      shadow.map = null
    }
    touched++
  })
  return touched
}

/** Which backend draws now, and which one the next page load will choose. */
export function backendReport(context, { backend }) {
  const drawing = context.renderer?.backend?.webgpu === true ? 'webgpu'
    : context.renderer ? 'webgl' : 'none (headless)'
  return { drawing, chosen: backend, reloadNeeded: context.renderer ? drawing !== backend : false }
}

/** Store the backend the next page load will choose. */
export function storeBackend({ backend }) {
  try { globalThis.localStorage?.setItem(BACKEND_KEY, backend === 'webgl' ? 'true' : 'false') } catch { /* no storage */ }
}

/** Put three back the way the engine starts, for when the plugin is switched off. */
export function restoreDefaults(context, THREE) {
  const found = parts(context)
  if (!found) return
  found.renderer.toneMapping = THREE.NoToneMapping
  found.renderer.toneMappingExposure = 1
  found.renderer.shadowMap.type = THREE.PCFShadowMap
  dropProbe(context)
  applyReadability(context, { readability: 'on' })
  useEnvironment(found.scene, null)
  found.scene.environmentIntensity = 1
  applyShadowQuality(context, { shadows: 'sharp', shadowSize: 1024 })
  recompile(found.scene)
}
