/**
 * Which coding agent a run spends its attempts on.
 *
 * Every wrapper named here prints the same envelope and takes the same flags,
 * so the rest of Dream spawns a harness without knowing which one it is. A new
 * harness is one wrapper and one line in this table.
 */
import path from 'node:path'

/** The wrapper each harness is driven through, relative to the checkout. */
const WRAPPERS = {
  dsh: 'tools/dsh-agent.mjs',
  pi: 'tools/pi-agent.mjs'
}

/** The harness a run uses when none is named. */
export const DEFAULT_HARNESS = 'dsh'

/** Every harness this checkout can run, for an error message or a flag's help. */
export const harnessNames = () => Object.keys(WRAPPERS)

/**
 * The wrapper script for one harness name.
 *
 * An unknown name throws rather than falling back, because a run that silently
 * played a different agent would be scored as if it had played the named one.
 */
export function harnessWrapper(checkout, harness = DEFAULT_HARNESS) {
  const wrapper = WRAPPERS[harness]
  if (!wrapper) throw new Error(`unknown harness "${harness}"; this checkout has ${harnessNames().join(', ')}`)
  return path.join(checkout, wrapper)
}
