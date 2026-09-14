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
 * `room` is three's RoomEnvironment filtered for rough and smooth surfaces. A
 * path is an equirectangular .hdr or .exr from the project's assets, which the
 * node renderer filters itself.
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
    texture = await new Loader().loadAsync(`/project/${path}`)
    texture.mapping = THREE.EquirectangularReflectionMapping
  }
  environments.set(name, texture)
  return texture
}

/** Environment light and its strength. Leaves the background to the Skybox plugin. */
export async function applyEnvironment(context, THREE, { environment, environmentIntensity }) {
  const found = parts(context)
  if (!found) return null
  const texture = environment === 'none' ? null : await environmentFor(THREE, found.renderer, environment)
  found.scene.environment = texture
  found.scene.environmentIntensity = environmentIntensity
  return texture ? environment : 'none'
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
  found.scene.environment = null
  found.scene.environmentIntensity = 1
  applyShadowQuality(context, { shadows: 'sharp', shadowSize: 1024 })
  recompile(found.scene)
}
