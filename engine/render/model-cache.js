/**
 * Kernel: a model file, fetched once, cloned per entity.
 *
 * The glTF loader is imported the first time a model is asked for, so a 2D game
 * that never loads one never pays for its parser.
 */
import { assetURL } from '../ui.js'
import { reportOnce } from './report.js'

let gltfLoader = null
let gltfLoading = null

/**
 * The glTF loader, fetched the first time a model is actually asked for.
 *
 * It ships inside the `three` package, so this is no new dependency either way —
 * but a static import would put its parser in front of every 2D game that will
 * never load a model. Loading a model is already asynchronous, so a dynamic
 * import costs nothing that was not already a wait.
 */
function gltf() {
  if (!gltfLoading) {
    gltfLoading = Promise.all([
      import('three/examples/jsm/loaders/GLTFLoader.js'),
      import('three/examples/jsm/utils/SkeletonUtils.js')
    ]).then(([loaderModule, skeletonModule]) => {
      cloneSkinned = skeletonModule.clone
      gltfLoader = new loaderModule.GLTFLoader()
      return gltfLoader
    })
  }
  return gltfLoading
}

let cloneSkinned = null

/**
 * One entity's copy of a loaded model.
 *
 * `clone(true)` leaves a skinned mesh bound to the original's bones, so turning
 * the copy's bones would move nothing. SkeletonUtils rebinds each copy to its own.
 */
export function cloneModel(loaded) {
  let skinned = false
  loaded.traverse(node => {
    if (node.isSkinnedMesh) skinned = true
  })
  return skinned ? cloneSkinned(loaded) : loaded.clone(true)
}

export const modelCache = new Map() // file -> { status, scene, waiting }

/**
 * A loaded model, once — and then cloned per entity.
 *
 * Forty terrorists must not be forty downloads and must not share one transform,
 * so the file is fetched once and `clone()` gives each entity its own scene
 * graph while the geometry and the materials stay shared. That sharing is most
 * of why forty of them is affordable.
 *
 * A model that fails is reported by name and answers `onFail`, because a player
 * model that is silently invisible cannot be found by looking at the screen.
 */
export function cachedModel(file, onReady, onFail) {
  const found = modelCache.get(file)
  if (found) {
    if (found.status === 'ready') onReady(found.scene)
    else if (found.status === 'failed') onFail()
    else found.waiting.push({ onReady, onFail })
    return
  }

  const url = assetURL(file)
  const entry = { status: 'loading', scene: null, waiting: [{ onReady, onFail }] }
  modelCache.set(file, entry)

  /** Report a model that would not load, and answer every waiter with its failure. */
  const fail = detail => {
    entry.status = 'failed'
    reportOnce(`[render] missing model ${url} (referenced as "${file}")${detail ? ` — ${detail}` : ''}`)
    for (const w of entry.waiting) w.onFail()
    entry.waiting.length = 0
  }

  gltf()
    .then(instance =>
      instance.load(
        url,
        result => {
          entry.status = 'ready'
          entry.scene = result.scene
          for (const w of entry.waiting) w.onReady(entry.scene)
          entry.waiting.length = 0
        },
        undefined,
        error => fail(error?.message)
      )
    )
    .catch(error => fail(error?.message))
}

/**
 * Drop a cached model so the next request re-fetches the edited file.
 *
 * The clone each entity holds keeps drawing until something asks for the file
 * again, which is the caller's business, not this cache's.
 */
export function forgetModel(file) {
  const name = file.replace(/^assets\//, '')
  if (modelCache.has(file)) modelCache.delete(file)
  if (modelCache.has(name)) modelCache.delete(name)
}

/**
 * Drop every cached model and free the geometry and materials its scenes hold.
 *
 * `release` calls this: the renderer is finished, so every model the kernel
 * fetched is dead memory. A later page fetches the files again.
 */
export function clearModels() {
  for (const entry of modelCache.values()) disposeModel(entry.scene)
  modelCache.clear()
}

/** Dispose every geometry and material under one loaded model. */
function disposeModel(scene) {
  scene?.traverse(node => {
    node.geometry?.dispose()
    const materials = Array.isArray(node.material) ? node.material : [node.material]
    for (const material of materials) material?.dispose()
  })
}
