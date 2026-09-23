/**
 * Kernel: solid geometry cached by its dimensions, and the one merge that turns
 * a list of those into a single buffer for a batch.
 */
import * as THREE from 'three/webgpu'

export const UNIT_PLANE = new THREE.PlaneGeometry(1, 1)

/** Geometry cached by kind and dimensions, so a map of walls shares a handful of sizes. */
const geometryCache = new Map()

/** One solid shape per kind, built from its size and segment count. */
const SOLID_BY_KIND = {
  sphere: (w, h, d, parts) => new THREE.SphereGeometry(0.5, Math.max(8, parts * 2), Math.max(6, parts)).scale(w, h, d),
  quad: (w, h, d, parts) => new THREE.PlaneGeometry(w, h, parts, parts),
  box: (w, h, d, parts) => new THREE.BoxGeometry(w, h, d, parts, parts, parts)
}

/**
 * Solid geometry, cached by its dimensions.
 *
 * A map of four hundred walls is a handful of distinct sizes, and building four
 * hundred BoxGeometries to say so costs megabytes of buffers and a visible
 * hitch on load. Nothing here is ever disposed: the cache is keyed by size, so
 * it is bounded by how many sizes the project actually uses.
 */
export function solidGeometry(kind, w, h, d, segments = 1) {
  const parts = Math.max(1, Math.min(96, Math.round(segments) || 1))
  const key = `${kind}:${w},${h},${d}:${parts}`
  const cached = geometryCache.get(key)
  if (cached) return cached
  // A vertex shader can only move vertices that exist, so `segments` is what
  // makes a displacing material possible at all. Capped: past a point the
  // triangles cost more than the shape is worth, and an author who types a
  // thousand meant a hundred.
  const build = SOLID_BY_KIND[kind] || SOLID_BY_KIND.box
  const geometry = build(w, h, d, parts)
  // The second UV set is copied off the first BEFORE it is rewritten in metres,
  // so it is still the 0..1 parameterisation a baked lightmap wants. Two floats
  // per vertex on geometry that is already shared by every wall of this size is
  // not worth making conditional.
  geometry.setAttribute('uv1', geometry.attributes.uv.clone())
  measureUVsInMetres(geometry, kind, w, h, d)
  geometryCache.set(key, geometry)
  return geometry
}

/**
 * Rewrite UVs so that one unit of UV is one metre of surface.
 *
 * A BoxGeometry gives all six faces UVs from 0 to 1, so a single repeat count
 * spread over the lot makes the 0.3 m end of a 12 m wall show as many bricks as
 * the front of it. Measuring UVs in metres instead gives the texture one density
 * everywhere, and leaves `tiling` with only one thing to say: what that density
 * is. It costs nothing at runtime — the numbers are baked once, into geometry
 * that is then shared by every wall of that size.
 */
function measureUVsInMetres(geometry, kind, w, h, d) {
  const uv = geometry.attributes.uv
  // Face order is the order BoxGeometry builds them in: +X, -X, +Y, -Y, +Z, -Z.
  // A sphere is one continuous surface with one UV wrap; measuring it in metres
  // per "face" would tear it at the seam.
  if (kind === 'sphere') return
  const faces =
    kind === 'quad'
      ? [[w, h]]
      : [
          [d, h],
          [d, h],
          [w, d],
          [w, d],
          [w, h],
          [w, h]
        ]
  const perFace = uv.count / faces.length
  for (let i = 0; i < uv.count; i++) {
    const [faceWidth, faceHeight] = faces[Math.floor(i / perFace)]
    uv.setXY(i, uv.getX(i) * faceWidth, uv.getY(i) * faceHeight)
  }
  uv.needsUpdate = true
}

/**
 * One merged BufferGeometry from a list of meshes, in world space.
 *
 * Every source is one of the cached box or quad geometries, so the attribute set
 * is known exactly and there is nothing to negotiate: position, normal, uv, uv1.
 * The transform is baked in, which is the whole point — a batch draws with an
 * identity matrix and one call.
 */
export function mergeMeshes(members) {
  let vertices = 0
  let indices = 0
  for (const mesh of members) {
    vertices += mesh.geometry.attributes.position.count
    indices += mesh.geometry.index.count
  }

  const position = new Float32Array(vertices * 3)
  const normal = new Float32Array(vertices * 3)
  const uv = new Float32Array(vertices * 2)
  const uv1 = new Float32Array(vertices * 2)
  const index = vertices > 65535 ? new Uint32Array(indices) : new Uint16Array(indices)

  const point = new THREE.Vector3()
  const normalMatrix = new THREE.Matrix3()
  let vertexAt = 0
  let indexAt = 0

  for (const mesh of members) {
    mesh.updateMatrix()
    normalMatrix.getNormalMatrix(mesh.matrix)
    const geometry = mesh.geometry
    const p = geometry.attributes.position
    const n = geometry.attributes.normal
    const t = geometry.attributes.uv
    const t1 = geometry.attributes.uv1 || t

    for (let i = 0; i < p.count; i++) {
      const at = vertexAt + i
      point.fromBufferAttribute(p, i).applyMatrix4(mesh.matrix)
      position[at * 3] = point.x
      position[at * 3 + 1] = point.y
      position[at * 3 + 2] = point.z
      point.fromBufferAttribute(n, i).applyMatrix3(normalMatrix).normalize()
      normal[at * 3] = point.x
      normal[at * 3 + 1] = point.y
      normal[at * 3 + 2] = point.z
      uv[at * 2] = t.getX(i)
      uv[at * 2 + 1] = t.getY(i)
      uv1[at * 2] = t1.getX(i)
      uv1[at * 2 + 1] = t1.getY(i)
    }
    for (let i = 0; i < geometry.index.count; i++) index[indexAt + i] = vertexAt + geometry.index.getX(i)

    vertexAt += p.count
    indexAt += geometry.index.count
  }

  const merged = new THREE.BufferGeometry()
  merged.setAttribute('position', new THREE.BufferAttribute(position, 3))
  merged.setAttribute('normal', new THREE.BufferAttribute(normal, 3))
  merged.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  merged.setAttribute('uv1', new THREE.BufferAttribute(uv1, 2))
  merged.setIndex(new THREE.BufferAttribute(index, 1))
  merged.computeBoundingSphere()
  return merged
}
