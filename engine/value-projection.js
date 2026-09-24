/**
 * Kernel: one value written down and put back, under a stated policy.
 *
 * A checkpoint and a reload walk the same kinds of value — primitives, arrays,
 * plain objects, Set and Map, and a reference to an entity — and each has to
 * name what it could not carry. They differ in policy, not in shape: a
 * checkpoint keeps Set and Map in memory and loses one array element at a time,
 * while a reload writes to sessionStorage and drops whatever JSON cannot hold, a
 * whole array with it. Two hand-written walks drift; one walk driven by a policy
 * cannot.
 *
 * `makeValueProjection` builds both directions from one policy. A caller passes
 * the policy once, then reads `project` on the way out and `resolve` on the way
 * back.
 */

/** A value a policy could not carry. */
export const LOST = Symbol('lost')

/**
 * Build `project` and `resolve` for one policy.
 *
 * @param {object} policy How this caller writes a value down.
 * @param {number} policy.maxDepth How deep a value may nest before it is lost.
 * @param {boolean} policy.keepContainers Keep Set and Map, tagged, rather than
 *   treating them as objects JSON cannot hold.
 * @param {boolean} policy.keepLostKeys Keep a lost member of an object as
 *   LOST, so putting it back yields `undefined`, rather than omitting the key.
 * @param {boolean} policy.loseWholeArray Lose the whole array when one element
 *   is lost, because a shorter array is a different array.
 * @param {boolean} policy.keepUndefined Keep `undefined`; otherwise drop it
 *   without reporting, because a field that is not there is not a loss.
 * @param {boolean} policy.keepNonFinite Keep NaN and the infinities; otherwise
 *   report and drop them, because JSON writes both as `null`.
 * @param {boolean} policy.keepOtherPrimitives Keep symbols and bigints;
 *   otherwise report and drop them, because JSON cannot hold either.
 * @param {string} policy.entityTag The key a reference to an entity is written
 *   under.
 * @param {Function} policy.report `(lost, loss)` names one value left behind.
 *   `loss` is `{ reason, where, ...detail }`, with `reason` one of `function`,
 *   `number`, `kind`, `deep` and `notPlain`.
 * @returns {object} `project(value, live, lost, where, depth)` and
 *   `resolve(copy, resolveEntity, onMissing, where)`.
 */
export function makeValueProjection(policy) {
  /** A function is reported by name and never carried. */
  function projectFunction(lost, where) {
    policy.report(lost, { reason: 'function', where })
    return LOST
  }

  /** A non-finite number is dropped unless the policy keeps it, because JSON writes it as `null`. */
  function projectNumber(value, lost, where) {
    if (policy.keepNonFinite || Number.isFinite(value)) return value
    policy.report(lost, { reason: 'number', where, value })
    return LOST
  }

  /** A symbol or bigint is dropped unless the policy keeps it, because JSON cannot hold either. */
  function projectOtherPrimitive(value, kind, lost, where) {
    if (policy.keepOtherPrimitives) return value
    policy.report(lost, { reason: 'kind', where, kind })
    return LOST
  }

  /** One lost element loses the whole array when the policy says a shorter array is a different array. */
  function projectArray(value, live, lost, where, depth) {
    const out = []
    for (let index = 0; index < value.length; index++) {
      const item = project(value[index], live, lost, `${where}[${index}]`, depth + 1)
      if (item === LOST && policy.loseWholeArray) return LOST
      out.push(item)
    }
    return out
  }

  function projectSet(value, live, lost, where, depth) {
    return { $set: [...value].map((item, index) => project(item, live, lost, `${where}<${index}>`, depth + 1)) }
  }

  function projectMap(value, live, lost, where, depth) {
    return {
      $map: [...value].map(([key, item]) => [
        project(key, live, lost, `${where} key`, depth + 1),
        project(item, live, lost, `${where}[${String(key)}]`, depth + 1)
      ])
    }
  }

  /** A class instance is not plain data, so it is named and left behind. */
  function projectInstance(value, lost, where) {
    policy.report(lost, { reason: 'notPlain', where, name: value.constructor?.name })
    return LOST
  }

  /** A plain object keeps every carried member, and a lost one only when the policy keeps it. */
  function projectRecord(value, live, lost, where, depth) {
    const copy = {}
    for (const key of Object.keys(value)) {
      const item = project(value[key], live, lost, `${where}.${key}`, depth + 1)
      if (item !== LOST || policy.keepLostKeys) copy[key] = item
    }
    return copy
  }

  /** The two containers a policy may keep, and the writer for each. */
  const CONTAINERS = [
    { matches: value => value instanceof Set, project: projectSet },
    { matches: value => value instanceof Map, project: projectMap }
  ]

  /** Whether a value is plain data rather than a class instance. */
  function isPlainObject(value) {
    const prototype = Object.getPrototypeOf(value)
    return prototype === Object.prototype || prototype === null
  }

  /** A primitive, decided by its `typeof` kind. */
  function projectPrimitive(value, kind, lost, where) {
    if (value === undefined) return policy.keepUndefined ? undefined : LOST
    if (kind === 'function') return projectFunction(lost, where)
    if (kind === 'number') return projectNumber(value, lost, where)
    if (kind === 'boolean' || kind === 'string') return value
    return projectOtherPrimitive(value, kind, lost, where)
  }

  /** Everything that is not a primitive: a reference, a container, or plain data. */
  function projectObject(value, live, lost, where, depth) {
    if (live.has(value)) return { [policy.entityTag]: value.id }
    if (depth >= policy.maxDepth) {
      policy.report(lost, { reason: 'deep', where, maxDepth: policy.maxDepth })
      return LOST
    }
    if (Array.isArray(value)) return projectArray(value, live, lost, where, depth)
    if (policy.keepContainers) {
      const container = CONTAINERS.find(entry => entry.matches(value))
      if (container) return container.project(value, live, lost, where, depth)
    }
    if (isPlainObject(value)) return projectRecord(value, live, lost, where, depth)
    return projectInstance(value, lost, where)
  }

  /**
   * Copy a value into plain data, or mark it LOST and name it.
   *
   * `live` is the entities: a reference to one is written as its id and
   * resolved again on the way back, because a state object holding two entities
   * is a graph and copying it would quietly split it into two.
   */
  function project(value, live, lost, where, depth = 0) {
    if (value === null) return null
    const kind = typeof value
    if (kind !== 'object') return projectPrimitive(value, kind, lost, where)
    return projectObject(value, live, lost, where, depth)
  }

  function resolveArray(copy, resolveEntity, onMissing, where) {
    return copy.map((item, index) => resolve(item, resolveEntity, onMissing, `${where}[${index}]`))
  }

  /** A reference to an entity resolves against the world it goes into, or is named missing. */
  function resolveReference(copy, resolveEntity, onMissing, where) {
    const entity = resolveEntity(copy[policy.entityTag])
    if (entity) return entity
    if (onMissing) onMissing(where, copy[policy.entityTag])
    return null
  }

  function resolveSet(copy, resolveEntity, onMissing, where) {
    return new Set(copy.$set.map(item => resolve(item, resolveEntity, onMissing, where)))
  }

  function resolveMap(copy, resolveEntity, onMissing, where) {
    return new Map(
      copy.$map.map(([key, item]) => [
        resolve(key, resolveEntity, onMissing, where),
        resolve(item, resolveEntity, onMissing, where)
      ])
    )
  }

  /** A plain object resolves each member at its own path. */
  function resolveRecord(copy, resolveEntity, onMissing, where) {
    const value = {}
    for (const key of Object.keys(copy)) {
      value[key] = resolve(copy[key], resolveEntity, onMissing, `${where}.${key}`)
    }
    return value
  }

  /** The two containers a policy may keep, and the reader for each. */
  const RESOLVERS = [
    { matches: copy => Array.isArray(copy.$set), resolve: resolveSet },
    { matches: copy => Array.isArray(copy.$map), resolve: resolveMap }
  ]

  /** Everything a copy can be: an array, a reference, a container, or plain data. */
  function resolveObject(copy, resolveEntity, onMissing, where) {
    if (Array.isArray(copy)) return resolveArray(copy, resolveEntity, onMissing, where)
    if (typeof copy[policy.entityTag] === 'string') return resolveReference(copy, resolveEntity, onMissing, where)
    if (policy.keepContainers) {
      const resolver = RESOLVERS.find(entry => entry.matches(copy))
      if (resolver) return resolver.resolve(copy, resolveEntity, onMissing, where)
    }
    return resolveRecord(copy, resolveEntity, onMissing, where)
  }

  /**
   * Put a projected value back.
   *
   * A reference to an entity resolves against the world it goes into; when the
   * world no longer holds it, `onMissing` names it and the value is `null`.
   */
  function resolve(copy, resolveEntity, onMissing = null, where = '') {
    if (copy === LOST) return undefined
    if (copy === null || typeof copy !== 'object') return copy
    return resolveObject(copy, resolveEntity, onMissing, where)
  }

  return { project, resolve }
}
