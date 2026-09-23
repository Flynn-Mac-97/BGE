/**
 * Kernel: loads plugins and collects what they contribute.
 *
 * It collects the seven contribution points and hands them to whoever consumes
 * them, so the shell and the loop never learn which plugin supplied a panel or
 * a system. Activation is ordered by declared needs and services; a plugin that
 * fails is contained, and its dependents go with it.
 */
import { compileSchedule, makePluginScope } from './plugin-runtime.js'
const POINTS = ['panels', 'tools', 'commands', 'fields', 'importers', 'systems', 'menus']
const NOTHING = Object.freeze({ name: null, about: '' })
/** An error as a reader wants it: the kind of failure, then what went wrong. */
const describe = error =>
  error?.name && error?.message ? `${error.name}: ${error.message}` : String(error?.message || error)

/** Every needs/provides/requires field is a list of names, or absent. */
function assertNameFields(definition) {
  for (const field of ['needs', 'provides', 'requires']) {
    if (definition[field] === undefined) continue
    const malformed =
      !Array.isArray(definition[field]) || definition[field].some(value => typeof value !== 'string' || !value)
    if (malformed) throw new Error(`${definition.name}.${field} must be an array of names`)
  }
}

/** One provider per service name; two plugins claiming one is refused. */
function claimServices(definition, providers) {
  for (const key of definition.provides || []) {
    if (providers.has(key))
      throw new Error(`service ${key} declared by both ${providers.get(key)} and ${definition.name}`)
    providers.set(key, definition.name)
  }
}

/**
 * Read every definition's name, its field shapes and its service claims.
 *
 * Throws on a duplicate name or a malformed field list, because each leaves the
 * order undefined rather than merely short.
 */
function declareDefinitions(definitions) {
  const byName = new Map()
  const providers = new Map()
  for (const definition of definitions) {
    if (!definition?.name) throw new Error('plugin has no name')
    if (byName.has(definition.name)) throw new Error(`duplicate plugin: ${definition.name}`)
    byName.set(definition.name, definition)
    assertNameFields(definition)
    claimServices(definition, providers)
  }
  return { byName, providers }
}

/**
 * The plugin loader: registration, activation order and the compiled schedule.
 *
 * @param {object} bus The bus every plugin error and change is announced on.
 * @returns {object} Registries, `order`, `add`, `enable`, `boot` and `contracts`.
 */
export function makeLoader(bus) {
  const plugins = new Map(),
    services = new Map()
  const contrib = Object.fromEntries(POINTS.map(point => [point, []]))
  let context = null,
    schedule = { fixed: [], frame: [] },
    scheduleError = null
  const diagnostics = []
  const report = (name, error) => {
    bus.emit('plugin:error', { name, error })
    diagnostics.push({ plugin: name, error })
    if (diagnostics.length > 100) diagnostics.shift()
  }
  const dependencies = definition => [
    ...new Set([
      ...(definition.needs || []),
      ...(definition.requires || [])
        .map(
          key => [...plugins.values()].find(plugin => (plugin.definition.provides || []).includes(key))?.definition.name
        )
        .filter(Boolean)
    ])
  ]

  /** Revoke a plugin's scope and leave it inactive, ready for a fresh scope on the next enable. */
  function cleanup(name, plugin) {
    for (const error of plugin.scope?.dispose() || []) report(name, `cleanup: ${error}`)
    plugin.scope = null
    plugin.active = false
  }
  /**
   * Turn a plugin off, and its enabled dependents before it.
   *
   * Dependents go first so nothing is left running against a service that is
   * about to disappear. `visited` stops a dependency cycle from recursing.
   */
  function deactivate(name, reason, visited = new Set()) {
    if (visited.has(name)) return
    visited.add(name)
    for (const [other, plugin] of plugins) {
      if (plugin.enabled && dependencies(plugin.definition).includes(name))
        deactivate(other, `dependency disabled: ${name}`, visited)
    }
    const plugin = plugins.get(name)
    if (!plugin) return
    cleanup(name, plugin)
    plugin.enabled = false
    if (reason) {
      plugin.error = reason
      report(name, reason)
    }
  }
  /**
   * Rebuild the contribution lists and both schedules from the enabled plugins.
   *
   * An invalid schedule empties it rather than leaving the last good one in
   * place: a stale order would run a plugin that is no longer registered.
   */
  function rebuild() {
    for (const point of POINTS) contrib[point] = []
    for (const { definition, enabled, builtin } of plugins.values()) {
      if (!enabled) continue
      for (const point of POINTS)
        for (const item of definition[point] || []) contrib[point].push({ ...item, plugin: definition.name, builtin })
    }
    try {
      schedule = compileSchedule(contrib.systems)
      contrib.systems = [...schedule.fixed, ...schedule.frame]
      scheduleError = null
    } catch (error) {
      if (scheduleError !== error.message) report('System Schedule', error.message)
      scheduleError = error.message
      schedule = { fixed: [], frame: [] }
      contrib.systems = []
    }
    bus.emit('plugins:changed')
  }
  /** Refuse a plugin whose dependencies are not all enabled and active. */
  function assertDependenciesReady(name, plugin) {
    for (const need of dependencies(plugin.definition)) {
      if (!plugins.get(need)?.enabled || !plugins.get(need)?.active) {
        throw new Error(`${name}: dependency unavailable: ${need}`)
      }
    }
  }

  /** Refuse a plugin whose required service no plugin provides. */
  function assertServicesAvailable(name, plugin) {
    for (const key of plugin.definition.requires || []) {
      if (!services.has(key)) throw new Error(`${name}: service unavailable: ${key}`)
    }
  }

  /** Refuse a plugin that named a service it did not register under its own name. */
  function assertServicesProvided(name, plugin) {
    for (const key of plugin.definition.provides || []) {
      if (services.get(key)?.owner !== name) throw new Error(`${name}: declared service was not provided: ${key}`)
    }
  }

  /**
   * Run a scoped plugin's onLoad and settle the scope it built.
   *
   * A scoped onLoad must be synchronous: a promise it returned would let the
   * plugin go on running after the boot called it loaded, so the promise is
   * reported and the call is refused.
   */
  function runOnLoad(name, plugin, scope) {
    const result = plugin.definition.onLoad?.(context, scope)
    if (result && typeof result.then === 'function' && plugin.definition.lifecycle === 'scoped') {
      Promise.resolve(result).catch(error => report(name, `async initialization: ${describe(error)}`))
      throw new Error(`${name}: scoped onLoad must be synchronous; register background-job cleanup with scope.defer`)
    }
    if (typeof result === 'function') scope.defer(result)
    assertServicesProvided(name, plugin)
  }

  /**
   * Run one plugin's onLoad inside its scope, once its dependencies and every
   * required service are present. Throws on failure; the caller deactivates and
   * reports, so a broken plugin contributes nothing.
   */
  function activate(name) {
    const plugin = plugins.get(name)
    if (!plugin || plugin.active) return
    assertDependenciesReady(name, plugin)
    assertServicesAvailable(name, plugin)
    // Legacy registrations keep their original enable behaviour until migrated to scopes.
    if (plugin.loaded && plugin.definition.lifecycle !== 'scoped') {
      plugin.active = true
      return
    }
    const scope = makePluginScope(name, plugin.definition, bus, services)
    plugin.scope = scope
    try {
      runOnLoad(name, plugin, scope)
      plugin.active = true
      plugin.loaded = true
      plugin.error = null
    } catch (error) {
      cleanup(name, plugin)
      throw error
    }
  }

  const api = {
    plugins,
    contrib,
    get schedule() {
      return schedule
    },
    /**
     * Definitions in dependency order, needs before dependents.
     *
     * Throws on a duplicate name, a missing dependency or service, and a cycle,
     * because each leaves the order undefined rather than merely short.
     */
    order(definitions) {
      const { byName, providers } = declareDefinitions(definitions)
      const seen = new Set(),
        out = []
      const visit = (definition, stack = []) => {
        if (seen.has(definition.name)) return
        if (stack.includes(definition.name))
          throw new Error(`plugin cycle: ${[...stack, definition.name].join(' -> ')}`)
        const needs = [
          ...(definition.needs || []),
          ...(definition.requires || []).map(key => {
            if (!providers.has(key)) throw new Error(`${definition.name}: missing service provider: ${key}`)
            return providers.get(key)
          })
        ]
        for (const need of needs) {
          if (!byName.has(need)) throw new Error(`${definition.name}: missing plugin dependency: ${need}`)
          visit(byName.get(need), [...stack, definition.name])
        }
        seen.add(definition.name)
        out.push(definition)
      }
      definitions.forEach(definition => visit(definition))
      return out
    },

    /** Register one definition. With a context already booted, activate it now. */
    add(definition, builtin = false) {
      if (!definition?.name) throw new Error('plugin has no name')
      if (plugins.has(definition.name)) throw new Error(`duplicate plugin: ${definition.name}`)
      plugins.set(definition.name, { definition, enabled: true, error: null, builtin, active: false, loaded: false })
      if (context) {
        try {
          activate(definition.name)
        } catch (error) {
          deactivate(definition.name, describe(error))
          rebuild()
          throw error
        }
        rebuild()
      }
    },
    /** Turn one plugin on or off, cascading to the plugins that depend on it. */
    enable(name, on) {
      const plugin = plugins.get(name)
      if (!plugin) throw new Error(`unknown plugin: ${name}`)
      if (!on) deactivate(name)
      else {
        plugin.enabled = true
        if (context)
          try {
            activate(name)
          } catch (error) {
            deactivate(name, describe(error))
            rebuild()
            throw error
          }
      }
      rebuild()
    },
    /** Stop a plugin whose system threw mid-tick, and everything depending on it. */
    fail(name, error) {
      if (!plugins.has(name)) return
      deactivate(name, describe(error))
      rebuild()
    },
    /**
     * Record a file that would not import under its path, disabled.
     *
     * It has no plugin name, so the path is its key; a command it would have
     * owned then answers as missing instead of failing silently.
     */
    failedImport(file, error, builtin = false) {
      const path = String(file).replaceAll('\\', '/')
      const reason = describe(error)
      plugins.set(path, { definition: NOTHING, enabled: false, error: reason, builtin, file: path })
      bus.emit('plugin:error', { name: path, file: path, error: reason })
    },
    /** The failed plugins and failed imports, as the shell and an agent report them. */
    failures() {
      return [...plugins.entries()]
        .filter(([, plugin]) => plugin.error)
        .map(([key, plugin]) => ({
          name: plugin.file ? null : key,
          file: plugin.file || null,
          error: plugin.error,
          builtin: plugin.builtin === true,
          failedToImport: plugin.file != null
        }))
    },
    /**
     * Activate every enabled plugin in dependency order.
     *
     * A plugin that replaces a context key it did not own is recorded and does
     * not stop the boot.
     */
    boot(value) {
      context = value
      const values = () =>
        new Map(
          Object.keys(context)
            .filter(key => !Object.getOwnPropertyDescriptor(context, key)?.get)
            .map(key => [key, context[key]])
        )
      const owners = new Map([...values().keys()].map(key => [key, 'the kernel']))
      const ordered = api.order(
        [...plugins.values()].filter(plugin => plugin.definition.name).map(plugin => plugin.definition)
      )
      for (const definition of ordered) {
        const name = definition.name,
          plugin = plugins.get(name)
        if (!plugin.enabled) continue
        const before = values()
        try {
          activate(name)
        } catch (error) {
          deactivate(name, describe(error))
        }
        for (const [key, current] of values()) {
          if (!before.has(key)) {
            owners.set(key, name)
            continue
          }
          if (before.get(key) === current) continue
          const error = `${name} replaced context.${key}, which belonged to ${owners.get(key) || 'another plugin'}`
          diagnostics.push({ plugin: name, error })
          console.error(`[loader] ${error}`)
          bus.emit('context:replaced', { key, by: name, from: owners.get(key) || null })
          owners.set(key, name)
        }
      }
      rebuild()
    },
    /** Deactivate every plugin in reverse registration order. */
    dispose() {
      for (const name of [...plugins.keys()].reverse()) deactivate(name)
      rebuild()
    },
    /** The read-only report of plugins, services and the compiled schedule. */
    contracts() {
      return {
        plugins: [...plugins.values()]
          .filter(plugin => plugin.definition.name)
          .map(plugin => ({
            name: plugin.definition.name,
            enabled: plugin.enabled,
            active: plugin.active,
            lifecycle: plugin.definition.lifecycle || 'legacy',
            needs: plugin.definition.needs || [],
            provides: plugin.definition.provides || [],
            requires: plugin.definition.requires || [],
            error: plugin.error
          })),
        services: [...services].map(([name, service]) => ({ name, owner: service.owner })),
        schedule: Object.fromEntries(
          Object.entries(schedule).map(([phase, systems]) => [
            phase,
            systems.map(system => ({
              id: system.id,
              plugin: system.plugin,
              before: system.before || [],
              after: system.after || [],
              reads: system.reads || [],
              writes: system.writes || [],
              dataContractDeclared: Array.isArray(system.reads) && Array.isArray(system.writes)
            }))
          ])
        ),
        scheduleError,
        diagnostics: diagnostics.slice(-20)
      }
    },
    rebuild
  }
  return api
}
