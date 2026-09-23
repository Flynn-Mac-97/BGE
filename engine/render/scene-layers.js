/**
 * Kernel: the two layers the scene draws on.
 *
 * The camera draws `DRAWN`. A merged entity keeps its own mesh on `MERGED`,
 * which the camera ignores and the raycaster does not, so picking still answers
 * against real geometry.
 */
export const DRAWN = 0 // layer the camera renders
export const MERGED = 1 // layer only the raycaster looks at
