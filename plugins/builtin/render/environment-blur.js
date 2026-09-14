/**
 * Environment reflections blurred to Blender's roughness.
 *
 * three's PMREMGenerator filters each level for one roughness and its lookup
 * reads that level for a smaller one, so every rough surface reflects too
 * sharply. Measured against Cycles on metal test spheres under the same .exr:
 * a Blender roughness of 0.3, 0.5, 0.7 or 0.9 matches three at 0.4, 0.6, 0.8
 * or 1.0, and 0.1 matches 0.1. The same code is in three's dev branch as of
 * September 2026, so this stays until three changes it.
 *
 * The fix raises the roughness the lookup asks for. Materials keep their own
 * roughness, so direct light, which already matches Cycles, is unchanged.
 */

/** Roughness the lookup asks for, for a material roughness. */
export const lookupRoughness = (TSL, roughness) =>
  TSL.min(TSL.float(1), roughness.add(TSL.smoothstep(0.1, 0.3, roughness).mul(0.1)))

/** The same curve in plain numbers, for tests and reports. */
export const lookupRoughnessNumber = roughness => {
  const t = Math.min(1, Math.max(0, (roughness - 0.1) / 0.2))
  return Math.min(1, roughness + 0.1 * t * t * (3 - 2 * t))
}

/** A scene environment node for a filtered environment texture. */
export function correctedEnvironment(THREE, TSL, texture) {
  class CorrectedPMREMNode extends THREE.PMREMNode {
    setup(builder) {
      const previous = builder.getContext()
      const asked = previous.getTextureLevel
      if (this.levelNode || !asked) return super.setup(builder)
      builder.setContext({ ...previous, getTextureLevel: node => lookupRoughness(TSL, TSL.float(asked(node))) })
      try {
        return super.setup(builder)
      } finally {
        builder.setContext(previous)
      }
    }
  }
  return new CorrectedPMREMNode(texture)
}
