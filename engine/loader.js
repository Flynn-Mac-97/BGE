/**
 * Kernel: loads plugins and collects what they contribute.
 *
 * Built-ins load through this exact path with no extra privileges. If the API is
 * not good enough to build our own inspector, it is not good enough to ship.
 */
const POINTS = ['panels', 'tools', 'commands', 'fields', 'importers', 'systems', 'menus']

/** The definition a file that never imported did not export. It gives nothing. */
const NOTHING = Object.freeze({ name: null, about: '' })

/** An error as a reader wants it: the kind of failure, then what went wrong. */
const describe = error =>
  error?.name && error?.message ? `${error.name}: ${error.message}` : String(error?.message || error)

export function makeLoader(bus) {
  // name -> { definition, enabled, error, builtin }, plus a file that never
  // became a plugin, keyed by its path and carrying `file`.
  const plugins = new Map()
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
      p.error = describe(error)
      console.error(`[plugin:${name}]`, error)
      bus.emit('plugin:error', { name, error: p.error })
      rebuild()
    },

    /**
     * A file that threw on import, recorded as a plugin that is present and
     * broken rather than one that was never there.
     *
     * It has no definition and so no name, so its path is the key and travels
     * on as `file`. An empty definition stands in for the one it never
     * exported, because every reader of this map asks a definition what it
     * contributes and the honest answer is "nothing".
     */
    failedImport(file, error, builtin = false) {
      const path = String(file).replaceAll('\\', '/')
      const reason = describe(error)
      plugins.set(path, { definition: NOTHING, enabled: false, error: reason, builtin, file: path })
      bus.emit('plugin:error', { name: path, file: path, error: reason })
    },

    /**
     * Every plugin the loader could not use, with the reason. A failed import
     * has a `file` and no `name`; a plugin that threw in onLoad has a `name`
     * and no `file`, because by then the path is behind it.
     */
    failures() {
      return [...plugins.entries()].filter(([, p]) => p.error).map(([key, p]) => ({
        name: p.file ? null : key,
        file: p.file || null,
        error: p.error,
        builtin: p.builtin === true,
        failedToImport: p.file != null
      }))
    },

    /**
     * Run every plugin's onLoad, and say who took a name that was already taken.
     *
     * Contributing onto `context` is how a plugin publishes a verb, and two
     * plugins reaching for one name is a silent replacement — the loser is not
     * broken, it is absent, and nothing distinguishes that from never having
     * loaded. Run Clock assigned `context.run` and destroyed the kernel's
     * command runner; every `context.run(id)` in that project threw "not a
     * function", including the one a test is handed, and the game played on.
     *
     * Reported rather than refused. A game deliberately shadowing a builtin's
     * verb is a real thing to want, and the loader is not the place to decide
     * that it is wrong — but nobody may do it by accident and hear nothing.
     */
    boot(context) {
      // Data properties only. `context.selection` and `context.time` are
      // getters that answer freshly every read, so comparing what they returned
      // would report every plugin as replacing both of them.
      const values = () => new Map(Object.keys(context)
        .filter(key => !Object.getOwnPropertyDescriptor(context, key)?.get)
        .map(key => [key, context[key]]))

      const owner = new Map([...values().keys()].map(key => [key, 'the kernel']))
      for (const [name, p] of plugins) {
        if (!p.enabled) continue
        const before = values()
        try { p.definition.onLoad?.(context) } catch (e) { this.fail(name, e) }
        for (const [key, value] of values()) {
          if (!before.has(key)) { owner.set(key, name); continue }
          if (before.get(key) === value) continue
          console.error(`[loader] ${name} replaced context.${key}, which belonged to ${owner.get(key) || 'another plugin'}. ` +
            'Two plugins cannot own one name — the earlier one is now unreachable. Rename one of them.')
          bus.emit('context:replaced', { key, by: name, from: owner.get(key) || null })
          owner.set(key, name)
        }
      }
      rebuild()
    },

    rebuild
  }
}
