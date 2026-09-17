/**
 * Kernel: compiles plugin schedules and holds the resources a plugin owns.
 *
 * A schedule is compiled when registrations change, never inside a tick, so the
 * order systems run in cannot change mid-frame.
 */

/**
 * Compile the fixed and frame orders from the contributed systems.
 *
 * @param {Array} systems Systems, each with a `phase`, an optional `id`, and
 *   `before` / `after` names.
 * @returns {{ fixed: Array, frame: Array }} The ordered systems per phase.
 * @throws When a phase is unknown, an id repeats, a name is missing, or the
 *   ordering constraints form a cycle.
 */
export function compileSchedule(systems) {
  const nodes = systems.map((system, index) => ({ ...system, id: system.id || `${system.plugin}:${system.phase}:${index}` }))
  const byId = new Map()
  for (const node of nodes) {
    if (!['fixed', 'frame'].includes(node.phase)) throw new Error(`system ${node.id}: phase must be fixed or frame`)
    if (byId.has(node.id)) throw new Error(`duplicate system id: ${node.id}`)
    byId.set(node.id, node)
  }
  const result = { fixed: [], frame: [] }
  for (const phase of ['fixed', 'frame']) {
    const group = nodes.filter(node => node.phase === phase)
    const incoming = new Map(group.map(node => [node.id, new Set()]))
    for (const node of group) {
      for (const direction of ['before', 'after']) {
        if (node[direction] !== undefined && !Array.isArray(node[direction])) throw new Error(`${node.id}.${direction} must be an array`)
        for (const target of node[direction] || []) {
          if (!byId.has(target)) throw new Error(`system ${node.id}: missing ${direction} target ${target}`)
          if (byId.get(target).phase !== phase) throw new Error(`system ${node.id}: ${target} belongs to another phase`)
          incoming.get(direction === 'after' ? node.id : target).add(direction === 'after' ? target : node.id)
        }
      }
    }
    while (incoming.size) {
      const next = group.find(node => incoming.has(node.id) && incoming.get(node.id).size === 0)
      if (!next) throw new Error(`system cycle (${phase}): ${[...incoming.keys()].join(' -> ')}`)
      result[phase].push(next)
      incoming.delete(next.id)
      for (const requirements of incoming.values()) requirements.delete(next.id)
    }
  }
  return result
}

/**
 * Resources registered through a scope are revoked together, even after a
 * failed boot.
 *
 * @param {string} name The plugin's name, used in every error it throws.
 * @param {object} definition The definition, carrying `provides` and `requires`.
 * @param {object} bus The bus `on` registers listeners on.
 * @param {Map} services The shared service registry.
 * @returns {object} The scope: `defer`, `on`, `provide`, `require`, `dispose`.
 */
export function makePluginScope(name, definition, bus, services) {
  const cleanups = []
  let closed = false
  const check = () => { if (closed) throw new Error(`plugin scope closed: ${name}`) }
  const scope = {
    defer(dispose) { check(); if (typeof dispose !== 'function') throw new Error('cleanup must be a function'); cleanups.push(dispose); return dispose },
    on(event, listener) {
      check()
      const off = bus.on(event, (...args) => { if (!closed) listener(...args) })
      scope.defer(off)
      return off
    },
    provide(key, value) {
      check()
      if (!(definition.provides || []).includes(key)) throw new Error(`${name}: undeclared service ${key}`)
      if (services.has(key)) throw new Error(`service ${key} already owned by ${services.get(key).owner}`)
      services.set(key, { owner: name, value })
      scope.defer(() => { if (services.get(key)?.owner === name) services.delete(key) })
      return value
    },
    require(key) {
      check()
      if (!(definition.requires || []).includes(key)) throw new Error(`${name}: undeclared requirement ${key}`)
      const service = services.get(key)
      if (!service) throw new Error(`${name}: service unavailable: ${key}`)
      return service.value
    },
    dispose() {
      if (closed) return []
      closed = true
      const errors = []
      for (const cleanup of cleanups.reverse()) { try { cleanup() } catch (error) { errors.push(error.message) } }
      cleanups.length = 0
      return errors
    }
  }
  return scope
}
