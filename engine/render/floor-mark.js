/**
 * Kernel: the shape both floor marks share — the instanced unit quad their
 * places are written into.
 *
 * A contact shadow and a ground ring are the same kind of thing: a flat disc on
 * the floor, drawn in one instanced draw call. Each keeps its own geometry,
 * because an instanced attribute belongs to the geometry, but both grow their
 * room and write their instance matrices the same way, and this is that way.
 */

/**
 * One frame's floor marks, as parallel numeric arrays.
 *
 * A growing array of `{x, z, radius, strength}` objects meant fifty thousand
 * short-lived objects a frame on a moving level, and the collector paid for
 * every one. The fields are written by index instead, so nothing is allocated
 * once the arrays have reached their high-water mark.
 */
export function placeList() {
  return { count: 0, x: [], z: [], radius: [], colour: [], strength: [] }
}

/**
 * Write this frame's marks into an instanced quad mesh: a disc of the mark's
 * own radius, lifted to `height` above the floor, then whatever per-instance
 * values the mark carries.
 *
 * The instance matrix is written element by element. `Matrix4.makeScale` and
 * `setPosition` build one matrix and `setMatrixAt` copies it, which is three
 * calls and a copy per mark where the mark is only a scale and a translation.
 * Only the five entries a mark can change are written; the rest are seeded
 * once, when the room is built, by `seedInstanceMatrices`.
 */
export function placeMarks(places, { meshOf, height, grow, write, attributesOf = () => [] }) {
  if (!places.count) {
    const mesh = meshOf()
    if (mesh) mesh.count = 0
    return
  }
  grow(places.count)
  // `grow` may have built the mesh and its instanced attributes on this very
  // call, so both are read after it rather than before.
  const mesh = meshOf()
  const matrix = mesh.instanceMatrix
  const array = matrix.array
  for (let i = 0; i < places.count; i++) {
    const at = i * 16
    const wide = places.radius[i] * 2
    array[at] = wide
    array[at + 10] = wide
    array[at + 12] = places.x[i]
    array[at + 13] = height
    array[at + 14] = places.z[i]
    if (write) write(places, i)
  }
  mesh.count = places.count
  matrix.needsUpdate = true
  for (const attribute of attributesOf()) attribute.needsUpdate = true
}

/**
 * Seed the constant entries of an instanced quad's matrices, once per room.
 *
 * A floor mark is an axis-aligned scale and a translation, so of the sixteen
 * entries nine are always zero and two are always one. Writing the two ones
 * when the room is built leaves five to rewrite per mark per frame instead of
 * sixteen.
 */
export function seedInstanceMatrices(mesh) {
  const array = mesh.instanceMatrix.array
  for (let at = 5; at < array.length; at += 16) {
    array[at] = 1
    array[at + 10] = 1
  }
}
