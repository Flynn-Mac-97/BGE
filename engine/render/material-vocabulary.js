/**
 * Kernel: the two ways this renderer touches a material.
 *
 * Both are used by the object builder, the material registry and any pass that
 * owns a model, so the rule for each is in one place.
 */

/** Call `listener` with every material on one node, whether it has one or an array. */
export const eachMaterial = (node, listener) => {
  if (!node.material) return
  if (Array.isArray(node.material)) node.material.forEach(listener)
  else listener(node.material)
}

/**
 * Opacity, with the recompile three needs to honour it.
 *
 * `transparent` is part of the shader program's cache key, so flipping it
 * without `needsUpdate` leaves the mesh running the opaque program it was
 * compiled with, and `entity.opacity` silently does nothing at all. Only flag it
 * when the flag actually changed: a recompile every frame is its own bug.
 */
export function setMaterialOpacity(material, opacity) {
  material.opacity = opacity
  const wantsBlending = opacity < 1
  if (material.transparent === wantsBlending) return
  material.transparent = wantsBlending
  material.needsUpdate = true
}
