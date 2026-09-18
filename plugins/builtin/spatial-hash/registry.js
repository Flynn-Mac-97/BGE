/**
 * Kernel: one named group per name, made on first ask.
 *
 * Spatial Hash hands out its groups from here and Crowd wraps the same group
 * under the same name, so a crowd and a spatial query never disagree about who
 * is in a group. Two hand-written registries drifted apart once already.
 */

/**
 * @param make  builds one group: `(name, options) => group`
 */
export function groupRegistry(make) {
  const groups = new Map()
  return {
    group(name, options) {
      const existing = groups.get(name)
      if (existing) return existing
      const made = make(name, options)
      groups.set(name, made)
      return made
    },
    get: name => groups.get(name) || null,
    forget(name) {
      groups.get(name)?.clear()
      return groups.delete(name)
    },
    get groups() { return [...groups.values()] }
  }
}
