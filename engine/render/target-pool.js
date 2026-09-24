/**
 * Kernel: render targets reused across frames, keyed by descriptor and size.
 *
 * Two passes that declare the same descriptor must draw into the same memory,
 * and only one allocator can see both. A target is made once, handed out by
 * `acquire`, and put back by `release`; a resize sizes every pooled target once
 * instead of per frame. A steady frame creates nothing.
 *
 * A descriptor names a resource `kind`: `colour` is a colour texture, `depth` is
 * a readable depth texture. The kind is part of the key, so a colour and a depth
 * resource never share a target.
 *
 * The pool also holds the device pixel ratio, because a target's size is the
 * drawing buffer's size: a screen-sized target must follow the ratio or it
 * draws at the wrong resolution after the window moves to another display.
 */
import * as THREE from 'three/webgpu'

const DEFAULT = { scale: 1, format: 'unsigned-byte', samples: 0, depth: true, stencil: false }
const TYPES = {
  'unsigned-byte': THREE.UnsignedByteType,
  'half-float': THREE.HalfFloatType,
  float: THREE.FloatType
}

/** The resource kind a descriptor names. Colour is the default. */
function kindOf(descriptor) {
  return descriptor.kind === 'depth' ? 'depth' : 'colour'
}

/** A stated ratio, or one, because a target of zero pixels is not a target. */
const usableRatio = value => (Number.isFinite(value) && value > 0 ? value : 1)

/** One string for one descriptor, so equal descriptors share one target. */
export function descriptorKey(descriptor = {}) {
  return [
    kindOf(descriptor),
    descriptor.scale ?? DEFAULT.scale,
    descriptor.format ?? DEFAULT.format,
    descriptor.samples ?? DEFAULT.samples,
    descriptor.depth === false ? 0 : 1,
    descriptor.stencil === true ? 1 : 0
  ].join('|')
}

export function makeTargetPool(options = {}) {
  // A format this pool cannot build is reported rather than silently drawn as
  // the default, so a pass that asked for float cannot appear to have got it.
  const report = options.report ?? (() => {})
  // Descriptor key -> targets free to be handed out again.
  const free = new Map()
  // Every target the pool holds, so one resize sizes all of them and a dropped
  // descriptor can give its memory back.
  const entries = []
  let width = 1
  let height = 1
  let pixelRatio = usableRatio(options.pixelRatio)

  function sizeFor(scale) {
    return {
      w: Math.max(1, Math.round(width * scale * pixelRatio)),
      h: Math.max(1, Math.round(height * scale * pixelRatio))
    }
  }

  function create(descriptor) {
    const scale = descriptor.scale ?? DEFAULT.scale
    const size = sizeFor(scale)
    const format = descriptor.format ?? DEFAULT.format
    if (!TYPES[format]) {
      report(`[render] target: no format called ${JSON.stringify(format)} — ${DEFAULT.format} stands in`)
    }
    const target = new THREE.RenderTarget(size.w, size.h, {
      type: TYPES[format] ?? TYPES[DEFAULT.format],
      samples: descriptor.samples ?? DEFAULT.samples,
      depthBuffer: descriptor.depth !== false,
      stencilBuffer: descriptor.stencil === true
    })
    // A depth resource is read through `target.depthTexture`; a colour resource
    // keeps the depth buffer private, as before.
    if (kindOf(descriptor) === 'depth') target.depthTexture = new THREE.DepthTexture(size.w, size.h)
    entries.push({ target, key: descriptorKey(descriptor), scale })
    return target
  }

  /** A target for this descriptor: a released one of the same key, or a new one. */
  function acquire(descriptor = {}) {
    const key = descriptorKey(descriptor)
    const list = free.get(key)
    if (list?.length) return list.pop()
    return create(descriptor)
  }

  /** Give a target back, so the next pass that declares the same key reuses it. */
  function release(target) {
    const entry = entries.find(one => one.target === target)
    if (!entry) return
    const list = free.get(entry.key)
    if (!list) {
      free.set(entry.key, [target])
      return
    }
    if (!list.includes(target)) list.push(target)
  }

  /** Size every target once for a new viewport. */
  function resize(nextWidth, nextHeight) {
    width = Math.max(1, Math.round(nextWidth))
    height = Math.max(1, Math.round(nextHeight))
    for (const entry of entries) {
      const size = sizeFor(entry.scale)
      entry.target.setSize(size.w, size.h)
      // `setSize` updates the colour textures only; a depth texture keeps its
      // own image size, so it is resized here or it samples the old frame shape.
      if (entry.target.depthTexture) {
        entry.target.depthTexture.image.width = size.w
        entry.target.depthTexture.image.height = size.h
      }
    }
  }

  /** Take a new device ratio and size every held target to match. */
  function setPixelRatio(ratio) {
    const wanted = usableRatio(ratio)
    if (wanted === pixelRatio) return
    pixelRatio = wanted
    resize(width, height)
  }

  /**
   * Drop every target and start the pool empty.
   *
   * A lost device takes every texture on it, so a held target is dead memory.
   * The next `acquire` makes new ones from the same descriptors. A caller that
   * still holds a target must drop it too, which the graph does for its slots.
   */
  function recreate() {
    for (const entry of entries) entry.target.dispose()
    entries.length = 0
    free.clear()
  }

  /**
   * Dispose every target whose descriptor key is not in `referencedKeys`.
   *
   * A pass a plugin removed no longer names its target, and leaving the
   * descriptor in place would hold the GPU memory for the life of the page.
   */
  function disposeUnused(referencedKeys) {
    for (const entry of entries.slice()) {
      if (referencedKeys.has(entry.key)) continue
      const list = free.get(entry.key)
      if (list) {
        const at = list.indexOf(entry.target)
        if (at >= 0) list.splice(at, 1)
        if (!list.length) free.delete(entry.key)
      }
      entry.target.dispose()
      entries.splice(entries.indexOf(entry), 1)
    }
  }

  function dispose() {
    recreate()
  }

  return {
    acquire,
    release,
    resize,
    setPixelRatio,
    recreate,
    disposeUnused,
    dispose,
    key: descriptorKey,
    /** How many targets the pool holds, live or free. A steady frame adds none. */
    get created() {
      return entries.length
    }
  }
}
