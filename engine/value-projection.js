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
  /**
   * Copy a value into plain data, or mark it LOST and name it.
   *
   * `live` is the entities: a reference to one is written as its id and
   * resolved again on the way back, because a state object holding two entities
   * is a graph and copying it would quietly split it into two.
   */
  function project(value, live, lost, where, depth = 0) {
    if (value === null) return null
    if (value === undefined) return policy.keepUndefined ? undefined : LOST
    const kind = typeof value
    if (kind === 'function') {
      policy.report(lost, { reason: 'function', where })
      return LOST
    }
    if (kind === 'number') {
      if (policy.keepNonFinite || Number.isFinite(value)) return value
      policy.report(lost, { reason: 'number', where, value })
      return LOST
    }
    if (kind === 'boolean' || kind === 'string') return value
    if (kind !== 'object') {
      if (policy.keepOtherPrimitives) return value
      policy.report(lost, { reason: 'kind', where, kind })
      return LOST
    }
    if (live.has(value)) return { [policy.entityTag]: value.id }
    if (depth >= policy.maxDepth) {
      policy.report(lost, { reason: 'deep', where, maxDepth: policy.maxDepth })
      return LOST
    }
    if (Array.isArray(value)) {
      const out = []
      for (let at = 0; at < value.length; at++) {
        const item = project(value[at], live, lost, `${where}[${at}]`, depth + 1)
        if (item === LOST && policy.loseWholeArray) return LOST
        out.push(item)
      }
      return out
    }
    if (policy.keepContainers && value instanceof Set) {
      return { $set: [...value].map((item, at) => project(item, live, lost, `${where}<${at}>`, depth + 1)) }
    }
    if (policy.keepContainers && value instanceof Map) {
      return {
        $map: [...value].map(([key, item]) => [
          project(key, live, lost, `${where} key`, depth + 1),
          project(item, live, lost, `${where}[${String(key)}]`, depth + 1)])
      }
    }
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      policy.report(lost, { reason: 'notPlain', where, name: value.constructor?.name })
      return LOST
    }
    const copy = {}
    for (const key of Object.keys(value)) {
      const item = project(value[key], live, lost, `${where}.${key}`, depth + 1)
      if (item !== LOST || policy.keepLostKeys) copy[key] = item
    }
    return copy
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
    if (Array.isArray(copy)) return copy.map((item, at) => resolve(item, resolveEntity, onMissing, `${where}[${at}]`))
    if (typeof copy[policy.entityTag] === 'string') {
      const entity = resolveEntity(copy[policy.entityTag])
      if (entity) return entity
      if (onMissing) onMissing(where, copy[policy.entityTag])
      return null
    }
    if (policy.keepContainers && Array.isArray(copy.$set)) {
      return new Set(copy.$set.map(item => resolve(item, resolveEntity, onMissing, where)))
    }
    if (policy.keepContainers && Array.isArray(copy.$map)) {
      return new Map(copy.$map.map(([key, item]) => [
        resolve(key, resolveEntity, onMissing, where),
        resolve(item, resolveEntity, onMissing, where)]))
    }
    const value = {}
    for (const key of Object.keys(copy)) value[key] = resolve(copy[key], resolveEntity, onMissing, `${where}.${key}`)
    return value
  }

  return { project, resolve }
}
