/**
 * Kernel: solid geometry cached by its dimensions, and the one merge that turns
 * a list of those into a single buffer for a batch.
 */
import * as THREE from 'three/webgpu'

/** The 1x1 plane every sprite and 2D quad shares before it is scaled to size. */
export const UNIT_PLANE = new THREE.PlaneGeometry(1, 1)

/** Geometry cached by kind and dimensions, so a map of walls shares a handful of sizes. */
const geometryCache = new Map()

/** One solid shape per kind, built from its size and segment count. */
const SOLID_BY_KIND = {
  sphere: (width, height, depth, parts) =>
    new THREE.SphereGeometry(0.5, Math.max(8, parts * 2), Math.max(6, parts)).scale(width, height, depth),
  quad: (width, height, depth, parts) => new THREE.PlaneGeometry(width, height, parts, parts),
  box: (width, height, depth, parts) => new THREE.BoxGeometry(width, height, depth, parts, parts, parts)
}

/**
 * Solid geometry, cached by its dimensions.
 *
 * A map of four hundred walls is a handful of distinct sizes, and building four
 * hundred BoxGeometries to say so costs megabytes of buffers and a visible
 * hitch on load. Nothing here is ever disposed: the cache is keyed by size, so
 * it is bounded by how many sizes the project actually uses.
 */
export function solidGeometry(kind, width, height, depth, segments = 1) {
  const parts = Math.max(1, Math.min(96, Math.round(segments) || 1))
  const key = `${kind}:${width},${height},${depth}:${parts}`
  const cached = geometryCache.get(key)
  if (cached) return cached
  // A vertex shader can only move vertices that exist, so `segments` is what
  // makes a displacing material possible at all. Capped: past a point the
  // triangles cost more than the shape is worth, and an author who types a
  // thousand meant a hundred.
  const build = SOLID_BY_KIND[kind] || SOLID_BY_KIND.box
  const geometry = build(width, height, depth, parts)
  // The second UV set is copied off the first BEFORE it is rewritten in metres,
  // so it is still the 0..1 parameterisation a baked lightmap wants. Two floats
  // per vertex on geometry that is already shared by every wall of this size is
  // not worth making conditional.
  geometry.setAttribute('uv1', geometry.attributes.uv.clone())
  measureUVsInMetres(geometry, kind, width, height, depth)
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
function measureUVsInMetres(geometry, kind, width, height, depth) {
  const uvAttribute = geometry.attributes.uv
  // Face order is the order BoxGeometry builds them in: +X, -X, +Y, -Y, +Z, -Z.
  // A sphere is one continuous surface with one UV wrap; measuring it in metres
  // per "face" would tear it at the seam.
  if (kind === 'sphere') return
  const faces =
    kind === 'quad'
      ? [[width, height]]
      : [
          [depth, height],
          [depth, height],
          [width, depth],
          [width, depth],
          [width, height],
          [width, height]
        ]
  const perFace = uvAttribute.count / faces.length
  for (let index = 0; index < uvAttribute.count; index++) {
    const [faceWidth, faceHeight] = faces[Math.floor(index / perFace)]
    uvAttribute.setXY(index, uvAttribute.getX(index) * faceWidth, uvAttribute.getY(index) * faceHeight)
  }
  uvAttribute.needsUpdate = true
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
  const uvArray = new Float32Array(vertices * 2)
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
    const positionAttribute = geometry.attributes.position
    const normalAttribute = geometry.attributes.normal
    const uvAttribute = geometry.attributes.uv
    const uv1Attribute = geometry.attributes.uv1 || uvAttribute

    for (let vertex = 0; vertex < positionAttribute.count; vertex++) {
      const absoluteVertex = vertexAt + vertex
      point.fromBufferAttribute(positionAttribute, vertex).applyMatrix4(mesh.matrix)
      position[absoluteVertex * 3] = point.x
      position[absoluteVertex * 3 + 1] = point.y
      position[absoluteVertex * 3 + 2] = point.z
      point.fromBufferAttribute(normalAttribute, vertex).applyMatrix3(normalMatrix).normalize()
      normal[absoluteVertex * 3] = point.x
      normal[absoluteVertex * 3 + 1] = point.y
      normal[absoluteVertex * 3 + 2] = point.z
      uvArray[absoluteVertex * 2] = uvAttribute.getX(vertex)
      uvArray[absoluteVertex * 2 + 1] = uvAttribute.getY(vertex)
      uv1[absoluteVertex * 2] = uv1Attribute.getX(vertex)
      uv1[absoluteVertex * 2 + 1] = uv1Attribute.getY(vertex)
    }
    for (let element = 0; element < geometry.index.count; element++)
      index[indexAt + element] = vertexAt + geometry.index.getX(element)

    vertexAt += positionAttribute.count
    indexAt += geometry.index.count
  }

  const merged = new THREE.BufferGeometry()
  merged.setAttribute('position', new THREE.BufferAttribute(position, 3))
  merged.setAttribute('normal', new THREE.BufferAttribute(normal, 3))
  merged.setAttribute('uv', new THREE.BufferAttribute(uvArray, 2))
  merged.setAttribute('uv1', new THREE.BufferAttribute(uv1, 2))
  merged.setIndex(new THREE.BufferAttribute(index, 1))
  merged.computeBoundingSphere()
  return merged
}
