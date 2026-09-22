/**
 * Kernel: one texture, cached, in three readings of the same file.
 *
 * `sprite`, `world` and `lightmap` differ in filtering, mipmaps and wrap, so the
 * reading is part of the cache key. Repeat lives on the texture object, so a
 * copy with its own repeat is cached by that repeat as well.
 *
 * The cache outlives any one renderer — `cachedTexture()` is shared by every renderer
 * the page makes — which is why the context's anisotropy limit is set here once
 * rather than threaded through every call.
 */
import * as THREE from 'three/webgpu'
import { assetURL } from '../ui.js'
import { reportOnce } from './report.js'

const loader = new THREE.TextureLoader()
const texCache = new Map()      // "mode:src"        -> the shared original
const texState = new Map()      // "mode:src"        -> { status, waiting }
const variantCache = new Map()  // "mode:u,v:src"    -> a copy with its own repeat

/**
 * The best anisotropy this GL context will do, read from the renderer once.
 *
 * It is a property of the context rather than of a texture, and `cachedTexture()` is
 * shared by every renderer the page makes — of which there is one. Reading it
 * here beats threading a renderer through every call site.
 */
let maxAnisotropy = 1

/** Whether a texture's file has arrived, is still loading, or failed. */
/** Record the best anisotropy this context will do. Called once, at init. */
export function setMaxAnisotropy(value) { maxAnisotropy = value }

export const textureStatus = (src, mode) => texState.get(`${mode}:${src}`)?.status || 'unknown'

/**
 * A texture, cached, in one of three readings of the same file.
 *
 * `sprite` is nearest-neighbour with no mipmaps, which is the only way pixel art
 * survives being scaled up. `world` is the opposite, and has to be: a floor
 * running to the horizon under a perspective camera samples far below one texel
 * per pixel, and without mipmaps and anisotropy it aliases into noise that
 * crawls as you walk. `lightmap` is `world` that does not repeat, because baked
 * light is one picture stretched over a surface rather than a pattern tiled
 * across it. The same file can be wanted several ways, so the reading is part of
 * the cache key rather than a property somebody mutates later.
 *
 * `onFail` is remembered rather than dropped. Registering it only on a cache
 * MISS meant that when forty walls shared one missing file, the first wall fell
 * back to a visible colour and the other thirty-nine drew as nothing at all —
 * an invisible wall with no message, which is the exact failure this engine
 * calls the worst one.
 */
export function cachedTexture(src, mode, onFail) {
  const key = `${mode}:${src}`
  const cached = texCache.get(key)
  if (cached) {
    const state = texState.get(key)
    // Already resolved either way: a failure the caller checks for with
    // textureStatus(), or an image that is already here.
    if (state?.status === 'loading' && onFail) state.waiting.push(onFail)
    return cached
  }

  const url = assetURL(src)
  const state = { status: 'loading', waiting: onFail ? [onFail] : [] }
  const t = loader.load(url,
    () => {
      state.status = 'ready'
      // Copies made while the file was in flight are holding off their upload
      // until now; see guardUpload.
      for (const fn of state.ready || []) fn()
      state.ready = null
    },
    undefined,
    () => {
      // A texture that 404s used to mean a blank viewport and an empty error
      // log — the single worst thing to hand an agent. Say it out loud instead.
      reportOnce(`[render] missing texture ${url} (referenced as "${src}")`)
      // The state table is the only record of this. A flag on the texture as
      // well would be a second source of truth for one fact, and the two would
      // eventually disagree.
      state.status = 'failed'
      for (const fn of state.waiting) fn()
      state.waiting.length = 0
    })

  if (mode === 'sprite') {
    // pixel art stays crisp: no smoothing, no mipmaps
    t.magFilter = THREE.NearestFilter
    t.minFilter = THREE.NearestFilter
    t.generateMipmaps = false
  } else {
    t.magFilter = THREE.LinearFilter
    t.minFilter = THREE.LinearMipmapLinearFilter
    t.generateMipmaps = true
    t.anisotropy = maxAnisotropy
    t.wrapS = t.wrapT = mode === 'lightmap' ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping
  }
  t.colorSpace = THREE.SRGBColorSpace
  texCache.set(key, t)
  texState.set(key, state)
  return t
}

/**
 * Hold a copy back until its picture has arrived.
 *
 * `Texture.clone()` shares the original's `Source` — so the image turns up in
 * the copy on its own — but it also flags the copy for upload on the spot. Three
 * then tries to upload a texture with no image every single frame and says so:
 * "Texture marked for update but no image data found", once per copy per frame,
 * which on a real level is several hundred lines a frame until the files land.
 * A warning storm trains everyone to ignore the console, so the copy waits its
 * turn instead. `version` is a plain counter and zero means "nothing to upload".
 */
function guardUpload(base, copy, src, mode) {
  if (base.image) return copy
  copy.version = 0
  const state = texState.get(`${mode}:${src}`)
  if (!state) return copy
  if (state.status === 'ready') { copy.needsUpdate = true; return copy }
  ;(state.ready = state.ready || []).push(() => { copy.needsUpdate = true })
  return copy
}

/**
 * A texture with its own repeat, cached by that repeat.
 *
 * Repeat lives on the texture object, so two walls tiling the same file at
 * different densities cannot share one — but four hundred walls tiling it the
 * SAME way can, and on a real map they mostly do. Caching the copy by its repeat
 * turns two hundred and thirty texture objects into eight, and it is what makes
 * one shared material per look possible, which is in turn what makes merging
 * possible.
 */
export function tiledTexture(src, mode, u, v, onFail) {
  const key = `${mode}:${u},${v}:${src}`
  const found = variantCache.get(key)
  if (found) return found
  const base = cachedTexture(src, mode, onFail)
  const copy = base.clone()
  copy.repeat.set(u, v)
  guardUpload(base, copy, src, mode)
  variantCache.set(key, copy)
  return copy
}

/**
 * A texture nobody else may touch.
 *
 * A tiled or sheeted sprite rewrites repeat and offset every frame from its own
 * frame number, so it cannot share a texture with anything — not even with
 * another entity showing a different frame of the same sheet.
 */
export function privateTexture(src, mode, onFail) {
  const base = cachedTexture(src, mode, onFail)
  return guardUpload(base, base.clone(), src, mode)
}


/**
 * Drop every cached reading of one edited file.
 *
 * A wall, a sprite and a lightmap can all be looking at the same edited PNG, so
 * every reading goes, and the next draw builds them again from the new file.
 */
export function forgetTextures(file) {
  const name = file.replace(/^assets\//, '')
  const matches = key => {
    const src = key.slice(key.lastIndexOf(':') + 1)
    return src === file || src === name
  }
  for (const key of [...texCache.keys()]) {
    if (!matches(key)) continue
    texCache.delete(key)
    texState.delete(key)
  }
  for (const key of [...variantCache.keys()]) if (matches(key)) variantCache.delete(key)
}
