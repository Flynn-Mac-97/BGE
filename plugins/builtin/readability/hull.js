/**
 * Readability: the geometry a keyline is drawn from, and the vertex node that grows
 * it by a fixed number of screen pixels.
 */
import * as THREE from 'three/webgpu'
import {
  cameraProjectionMatrix, float, max, modelNormalMatrix, modelViewMatrix,
  normalGeometry, normalize, positionLocal, screenSize, step, vec4
} from 'three/tsl'

/**
 * One averaged normal per distinct position.
 *
 * A hull grown along per-vertex normals splits open at every hard edge, because
 * a box corner carries three normals and each face grows a different way.
 * Averaging across coincident positions closes it. Face normals are left
 * unnormalised, so a large triangle counts for more than a sliver.
 */
function hullNormals(position, index) {
  const vertices = position.length / 3
  const keyAt = new Array(vertices)
  const sums = new Map()   // position, to a tenth of a millimetre -> its running sum

  for (let v = 0; v < vertices; v++) {
    const key = `${Math.round(position[v * 3] * 1e4)},${Math.round(position[v * 3 + 1] * 1e4)},${Math.round(position[v * 3 + 2] * 1e4)}`
    keyAt[v] = key
    if (!sums.has(key)) sums.set(key, [0, 0, 0])
  }

  const add = (vertex, x, y, z) => {
    const sum = sums.get(keyAt[vertex])
    sum[0] += x; sum[1] += y; sum[2] += z
  }

  for (let i = 0; i < index.length; i += 3) {
    const a = index[i], b = index[i + 1], c = index[i + 2]
    const ax = position[a * 3], ay = position[a * 3 + 1], az = position[a * 3 + 2]
    const bx = position[b * 3] - ax, by = position[b * 3 + 1] - ay, bz = position[b * 3 + 2] - az
    const cx = position[c * 3] - ax, cy = position[c * 3 + 1] - ay, cz = position[c * 3 + 2] - az
    const x = by * cz - bz * cy
    const y = bz * cx - bx * cz
    const z = bx * cy - by * cx
    add(a, x, y, z); add(b, x, y, z); add(c, x, y, z)
  }

  const normal = new Float32Array(position.length)
  for (let v = 0; v < vertices; v++) {
    const sum = sums.get(keyAt[v])
    const length = Math.hypot(sum[0], sum[1], sum[2]) || 1
    normal[v * 3] = sum[0] / length
    normal[v * 3 + 1] = sum[1] / length
    normal[v * 3 + 2] = sum[2] / length
  }
  return normal
}

/**
 * Six times the volume a closed mesh encloses, which is negative when its
 * faces are wound inward.
 *
 * The sum is the divergence theorem and does not depend on where the origin
 * is, so a mesh anywhere in the model answers the same.
 */
function signedVolume(position, index) {
  let total = 0
  for (let i = 0; i < index.length; i += 3) {
    const a = index[i] * 3, b = index[i + 1] * 3, c = index[i + 2] * 3
    total += position[a] * (position[b + 1] * position[c + 2] - position[b + 2] * position[c + 1])
      + position[a + 1] * (position[b + 2] * position[c] - position[b] * position[c + 2])
      + position[a + 2] * (position[b] * position[c + 1] - position[b + 1] * position[c])
  }
  return total
}

/** The positions and indices of one mesh, in the object's own space, or null when it is not shape. */
function meshInObjectSpace(node, toLocal, point, relative) {
  const attribute = node.isMesh ? node.geometry?.attributes?.position : null
  if (!attribute) return null
  relative.multiplyMatrices(toLocal, node.matrixWorld)

  const own = []
  for (let i = 0; i < attribute.count; i++) {
    point.fromBufferAttribute(attribute, i).applyMatrix4(relative)
    own.push(point.x, point.y, point.z)
  }
  const index = node.geometry.index
  const ownIndices = []
  if (index) for (let i = 0; i < index.count; i++) ownIndices.push(index.getX(i))
  else for (let i = 0; i < attribute.count; i++) ownIndices.push(i)
  return { own, ownIndices }
}

/** Add one mesh's geometry to the hull, unless it is a hull itself or wound inside out. */
function appendMesh(node, positions, indices, toLocal, point, relative) {
  // A hull already hanging off this object is not part of its shape.
  if (node.userData.keyline) return
  const mesh = meshInObjectSpace(node, toLocal, point, relative)
  if (!mesh) return
  // A mesh wound inside out is already an outline, modelled into the file as an
  // inverted hull, and its faces would read as the near surface and paint the
  // keyline colour across the body.
  if (signedVolume(mesh.own, mesh.ownIndices) < 0) return
  const first = positions.length / 3
  for (const value of mesh.own) positions.push(value)
  for (const at of mesh.ownIndices) indices.push(first + at)
}

/**
 * One geometry covering everything an object draws, in the object's own space.
 *
 * A keyline is one draw call per entity, so a model of fourteen meshes has to
 * become one buffer. Positions and normals only — a hull draws in one flat
 * colour and has no use for UVs or a second UV set.
 * */
export function hullGeometry(object) {
  object.updateWorldMatrix(false, true)
  const toLocal = new THREE.Matrix4().copy(object.matrixWorld).invert()
  const relative = new THREE.Matrix4()
  const point = new THREE.Vector3()
  const positions = []
  const indices = []

  object.traverse(node => appendMesh(node, positions, indices, toLocal, point, relative))

  if (!indices.length) return null
  const position = new Float32Array(positions)
  const index = position.length / 3 > 65535 ? new Uint32Array(indices) : new Uint16Array(indices)
  const hull = new THREE.BufferGeometry()
  hull.setAttribute('position', new THREE.BufferAttribute(position, 3))
  hull.setAttribute('normal', new THREE.BufferAttribute(hullNormals(position, index), 3))
  hull.setIndex(new THREE.BufferAttribute(index, 1))
  hull.computeBoundingSphere()
  return hull
}

/** Hulls by shape, so a hundred rats share one. Bounded by distinct shapes. */
export const hullCache = new Map()

/**
 * The hull's clip position, grown by a fixed number of PIXELS.
 *
 * A modelled outline is geometry, so its width shrinks with distance and is
 * under a pixel at the zoom this kind of game plays at. Offsetting in clip
 * space and undoing the perspective divide by hand keeps the line the same
 * width wherever the thing is standing, which is the whole point of it.
 */
export function keylineGrowth(width, flat) {
  const clip = cameraProjectionMatrix.mul(modelViewMatrix).mul(vec4(positionLocal, 1))
  const frame = screenSize

  // A solid grows along its vertex normal, which is its silhouette. A quad's
  // normals all point one way and project to nothing on screen, so it grows
  // away from its own centre instead — without that a sprite gets no outline.
  const centre = cameraProjectionMatrix.mul(modelViewMatrix).mul(vec4(0, 0, 0, 1))
  // The normal is turned into view space here rather than read from
  // `normalView`, which is empty in a vertex node.
  const direction = flat
    ? clip.xy.div(clip.w).sub(centre.xy.div(centre.w)).mul(frame)
    : cameraProjectionMatrix.mul(vec4(normalize(modelNormalMatrix.mul(normalGeometry)), 0)).xy.mul(frame)

  // A face turned exactly edge-on, or a vertex on the centre, has no screen
  // direction to grow along. `step` grows it by nothing rather than by NaN.
  const reach = direction.length()
  const offset = direction.div(max(reach, 1e-5))
    .mul(float(2 * width).div(frame))
    .mul(clip.w)
    .mul(step(1e-5, reach))

  // A flat hull sits in the plane of the quad it outlines and needs a nudge
  // away from the eye, or the two fight over every pixel. A solid hull draws
  // back faces only and needs none.
  const depth = flat ? clip.z.add(clip.w.mul(0.0004)) : clip.z
  return vec4(clip.xy.add(offset), depth, clip.w)
}

/**
 * Drop a cached hull traced from an edited model file.
 *
 * A keyline is traced from the file, so an edited model needs a new one; the
 * shape-keyed hulls for boxes and parts are not affected.
 */
export function forgetHull(file) {
  const name = file.replace(/^assets\//, '')
  hullCache.delete(`model:${file}`)
  hullCache.delete(`model:${name}`)
}
