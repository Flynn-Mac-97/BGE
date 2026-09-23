/**
 * Kernel: the placement shape a level save and a reload restore both build.
 *
 * Both write an entity out as the placement a level file holds: the behaviours
 * the placement adds, changes or takes off, and the property values it overrides.
 * Each had its own copy, one reading a live entity and the other a captured
 * record, so a save and a restore could drift apart. One home keeps them agreeing
 * on the shape.
 *
 * Policy stays with each caller, because the two jobs differ on purpose: a save
 * rounds a position and keeps every override it holds; a restore keeps the
 * captured position and drops an override whose value did not survive, so the
 * next save does not read it as a decision somebody made. The policy is passed
 * in, not copied.
 */

/**
 * What this placement says about behaviours — never what its type says.
 *
 * Only what it added, changed or took off, so a level diff shows the decision
 * somebody made rather than the whole inherited list. Array form when there is
 * nothing to configure, because `["float"]` is what a person would have typed.
 *
 * @param {Array} behaviours The placement's behaviour records: `name`, `own`,
 *   `overrides` and `bag`. A save reads the live records, a restore the captured
 *   ones; both carry the same fields.
 * @param {Iterable} detached Names the type declares and this placement took off.
 * @returns {Array|object|null} The `behaviours` value, or null when there is none.
 */
export function placementBehaviours(behaviours, detached) {
  const out = {}
  for (const record of behaviours) {
    if (!record.own && !record.overrides.length) continue
    out[record.name] = Object.fromEntries(record.overrides.map(key => [key, record.bag[key]]))
  }
  for (const name of detached) out[name] = false

  const names = Object.keys(out)
  if (!names.length) return null
  return names.every(name => out[name] && !Object.keys(out[name]).length) ? names : out
}

/**
 * The property values this placement overrides, keyed by property.
 *
 * @param {string[]} overrides The keys this placement disagrees with its type about.
 * @param {object} properties Their values.
 * @param {object} policy `keepUndefined` keeps a key whose value is undefined. A
 *   save keeps it; a restore drops it so the type's default stands instead.
 * @returns {object} The overridden properties, in override order.
 */
export function overriddenProperties(overrides, properties, { keepUndefined }) {
  const out = {}
  for (const key of overrides) {
    if (!keepUndefined && properties[key] === undefined) continue
    out[key] = properties[key]
  }
  return out
}
