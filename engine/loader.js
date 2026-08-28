/**
 * Kernel: loads plugins and collects what they contribute.
 *
 * Built-ins load through this exact path with no extra privileges. If the API is
 * not good enough to build our own inspector, it is not good enough to ship.
 */
const POINTS = ['panels', 'tools', 'commands', 'fields', 'importers', 'systems', 'menus']

export function makeLoader(bus) {
  const plugins = new Map()          // name -> { definition, enabled, error, builtin }
  const contrib = Object.fromEntries(POINTS.map(p => [p, []]))

  function rebuild() {
    for (const p of POINTS) contrib[p] = []
    for (const { definition, enabled, builtin } of plugins.values()) {
      if (!enabled) continue
      for (const p of POINTS) {
        // Where it came from travels with what it contributed, so the shell can
        // credit a project plugin's panel without reading its name for a clue.
        for (const item of definition[p] || []) contrib[p].push({ ...item, plugin: definition.name, builtin })
      }
    }
    bus.emit('plugins:changed')
  }

  return {
    plugins,
    contrib,

    /** Sort by declared dependencies so a plugin never loads before what it needs. */
    order(defs) {
      const byName = new Map(defs.map(d => [d.name, d]))
      const seen = new Set(), out = []
      const visit = (d, stack = []) => {
        if (seen.has(d.name)) return
        if (stack.includes(d.name)) throw new Error(`plugin cycle: ${[...stack, d.name].join(' -> ')}`)
        for (const need of d.needs || []) {
          const dep = byName.get(need)
          if (dep) visit(dep, [...stack, d.name])
        }
        seen.add(d.name)
        out.push(d)
      }
      defs.forEach(d => visit(d))
      return out
    },

    /** `builtin` is where the file was found, not something the plugin may claim. */
    add(definition, builtin = false) {
      if (!definition?.name) throw new Error('plugin has no name')
      plugins.set(definition.name, { definition, enabled: true, error: null, builtin })
    },

    enable(name, on) {
      const p = plugins.get(name)
      if (!p) return
      p.enabled = on
      rebuild()
    },

    /** A plugin that throws is disabled and reported — it never takes the editor with it. */
    fail(name, error) {
      const p = plugins.get(name)
      if (!p) return
      p.enabled = false
      p.error = String(error?.message || error)
      console.error(`[plugin:${name}]`, error)
      bus.emit('plugin:error', { name, error: p.error })
      rebuild()
    },

    boot(context) {
      for (const [name, p] of plugins) {
        if (!p.enabled) continue
        try { p.definition.onLoad?.(context) } catch (e) { this.fail(name, e) }
      }
      rebuild()
    },

    rebuild
  }
}
