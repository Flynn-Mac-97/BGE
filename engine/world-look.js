/**
 * Kernel: the look and merge vocabulary shared by placing an entity and saving it.
 *
 * A sprite or a mesh is written as a shorthand or as an object, and a placement
 * merges over its type rather than replacing it. Placing an entity and writing it
 * back to a level have to agree on what a value means, so both read the rules
 * here. `world.js` keeps the store; `world-state.js` writes the level shape.
 */

/** Placement keys the entity models directly; everything else is preserved verbatim. */
export const HANDLED = new Set([
  'type',
  'at',
  'rotation',
  'scale',
  'properties',
  'sprite',
  'mesh',
  'collider',
  'behaviours',
  'note'
])

/**
 * Names a behaviour may not take.
 *
 * Each behaviour gets `e[name]` as its own bag, so a behaviour called `scale`
 * would quietly replace the entity's scale with an object and the symptom would
 * be a thing that stops drawing. Refused by name instead, at attach time.
 */
export const RESERVED = new Set([
  'id',
  'type',
  'x',
  'y',
  'z',
  'rotation',
  'scale',
  'sprite',
  'mesh',
  'collider',
  'properties',
  'overrides',
  'behaviours',
  'hidden',
  'play',
  'note',
  'velocityX',
  'velocityY',
  'velocityZ',
  'grounded',
  'animation',
  'frame',
  'flip',
  'animationDone'
])

/**
 * Both ways of writing an attachment list, reduced to one shape.
 *
 *   behaviours: ['float']                  nothing to configure
 *   behaviours: { float: { speed: 3 } }    defaults changed here
 *   behaviours: { float: false }           this placement takes it back off
 */
export const asAttached = value => {
  if (!value) return {}
  if (Array.isArray(value)) return Object.fromEntries(value.map(name => [name, {}]))
  return value
}

/** Expand the shorthand form of a value: 'coin.png' -> { image: 'coin.png' } */
export const expand = (value, key) => (typeof value === 'string' ? { [key]: value } : value)

/**
 * The entity always holds the expanded object form, but the type may have
 * declared the string shorthand — compare what they mean, not how they were
 * written, or every save writes an override that is not one.
 */
export const sameLook = (first, second, key) => {
  const norm = value => JSON.stringify(expand(value, key) ?? null)
  return norm(first) === norm(second)
}

/**
 * A placement's `mesh` MERGES over the type's, key by key — it does not replace it.
 *
 * Replacing was the obvious reading and it was wrong. A map is hundreds of walls
 * that share one texture and differ only in size, and under replacement every one
 * of them had to repeat the texture, the tiling and the tint in order to change
 * the box. de_dust2 came out at 3,300 lines where 1,300 would do, and every read
 * of that file paid the difference. `properties` has always merged; this is the
 * same rule applied to the other thing a placement customises.
 *
 * `tint` is the key this surprises people on. A tint MULTIPLIES the texture
 * rather than standing in for one, so a tint on the TYPE is not a fallback: it
 * colours every textured placement that did not state its own, and the level
 * file says nothing about it. `check` reports that pair — see `tintProblems` in
 * engine/project-index.mjs.
 */
export const mergeLook = (base, over, key) => {
  const baseLook = expand(base, key)
  const overLook = expand(over, key)
  if (!baseLook) return overLook
  if (!overLook) return baseLook
  return { ...baseLook, ...overLook }
}

/** What this value says that its type default does not. The decision, not the copy. */
export const lookDiff = (value, base) => {
  if (!value) return null
  const out = {}
  for (const [fieldKey, fieldValue] of Object.entries(value)) {
    if (JSON.stringify(base?.[fieldKey]) !== JSON.stringify(fieldValue)) out[fieldKey] = fieldValue
  }
  return Object.keys(out).length ? out : null
}
