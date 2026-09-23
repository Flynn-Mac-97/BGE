/**
 * Kernel: render targets reused across frames, keyed by descriptor and size.
 *
 * Two passes that declare the same descriptor must draw into the same memory,
 * and only one allocator can see both. A target is made once, handed out by
 * `acquire`, and put back by `release`; a resize sizes every pooled target once
 * instead of per frame. A steady frame creates nothing.
 */
import * as THREE from 'three/webgpu'

const DEFAULT = { scale: 1, format: 'unsigned-byte', samples: 0, depth: true, stencil: false }
const TYPES = {
  'unsigned-byte': THREE.UnsignedByteType,
  'half-float': THREE.HalfFloatType,
  float: THREE.FloatType
}

/** One string for one descriptor, so equal descriptors share one target. */
export function descriptorKey(descriptor = {}) {
  return [
    descriptor.scale ?? DEFAULT.scale,
    descriptor.format ?? DEFAULT.format,
    descriptor.samples ?? DEFAULT.samples,
    descriptor.depth === false ? 0 : 1,
    descriptor.stencil === true ? 1 : 0
  ].join('|')
}

export function makeTargetPool() {
  // Descriptor key -> targets free to be handed out again.
  const free = new Map()
  // Every target the pool made, so one resize sizes all of them.
  const entries = []
  let width = 1
  let height = 1
  let created = 0

  function sizeFor(scale) {
    return {
      w: Math.max(1, Math.round(width * scale)),
      h: Math.max(1, Math.round(height * scale))
    }
  }

  function create(descriptor) {
    const scale = descriptor.scale ?? DEFAULT.scale
    const size = sizeFor(scale)
    const target = new THREE.RenderTarget(size.w, size.h, {
      type: TYPES[descriptor.format] ?? TYPES[DEFAULT.format],
      samples: descriptor.samples ?? DEFAULT.samples,
      depthBuffer: descriptor.depth !== false,
      stencilBuffer: descriptor.stencil === true
    })
    created++
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
    if (!list) { free.set(entry.key, [target]); return }
    if (!list.includes(target)) list.push(target)
  }

  /** Size every target once for a new viewport. */
  function resize(nextWidth, nextHeight) {
    width = Math.max(1, Math.round(nextWidth))
    height = Math.max(1, Math.round(nextHeight))
    for (const entry of entries) {
      const size = sizeFor(entry.scale)
      entry.target.setSize(size.w, size.h)
    }
  }

  function dispose() {
    for (const entry of entries) entry.target.dispose()
    entries.length = 0
    free.clear()
  }

  return {
    acquire,
    release,
    resize,
    dispose,
    key: descriptorKey,
    /** How many targets the pool has made. A steady frame adds none. */
    get created() { return created }
  }
}
