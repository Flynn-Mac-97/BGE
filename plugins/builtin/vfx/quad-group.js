/**
 * Kernel: the two things every instanced-quad painter builds the same way.
 *
 * A painter keeps one group per look — a blend mode, a texture, a decal image —
 * and grows it by doubling rather than allocating the ceiling up front: most
 * groups hold a handful of sparks and only one ever holds a screenful. The index
 * buffer is the same six indices per quad in every one of them, and never
 * changes once built.
 */

/** How many quads to allocate for `capacity`, doubled to a power of two, never below `least`. */
export function grownQuads(capacity, least) {
  return Math.max(least, 1 << Math.ceil(Math.log2(Math.max(1, capacity))))
}

/** The index buffer for `size` quads: two triangles each, in one weaving order. */
export function quadIndices(size) {
  const index = new Uint32Array(size * 6)
  for (let quad = 0; quad < size; quad++) {
    const v = quad * 4
    index.set([v, v + 1, v + 2, v, v + 2, v + 3], quad * 6)
  }
  return index
}
