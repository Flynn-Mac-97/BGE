/**
 * Rig Animation: what a clip name means. A name the type's `rig.clips`
 * declares is that file; a name that is itself a clip file under assets/
 * (`motion/hero/take-a.json`) is that file, so a state graph or a set can name
 * takes without every one being listed on the type.
 */

/** The clip file `name` means for `rig`, or undefined. */
export const clipFileOf = (rig, name) => rig?.clips?.[name] ?? (typeof name === 'string' && name.endsWith('.json') ? name : undefined)

/** The nodes a layer mask means: a list of nodes as it is, or a name in `rig.masks`. */
export const maskNodesOf = (rig, mask) => (Array.isArray(mask) ? mask : rig?.masks?.[mask])
