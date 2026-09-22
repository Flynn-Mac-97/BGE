/**
 * The invariant checks on a project's raw level placements.
 *
 * Split from `project-index.mjs`, which keeps building the index and
 * re-exports both checks so callers and tests keep one door. The builder calls
 * them after every type has loaded, because a level may be walked before the
 * type it places.
 */

/**
 * The drawn height of one placement, along the same rule engine/world.js's
 * `makeEntity` uses to build the real entity: a placement's `mesh` merges
 * over the type's key by key, so its box wins only when it states one, but a
 * placement's `collider` REPLACES the type's outright — a placement that
 * gives a collider with no box has no box at all, even if the type had one.
 * Returns null when neither the placement nor its type says a height.
 */
function placedHeight(type, placement) {
  const meshBox = Array.isArray(placement.mesh?.box) ? placement.mesh.box : type.meshBox
  const colliderBox = placement.collider
    ? (Array.isArray(placement.collider.box) ? placement.collider.box : undefined)
    : type.colliderBox
  const height = meshBox?.[1] ?? colliderBox?.[1]
  return Number.isFinite(height) ? height : null
}

/**
 * Named invariant rules a type may declare. Each takes the declared invariant,
 * the type's index entry and one raw placement, and returns `{ expected,
 * actual }` to compare, or null when this placement carries too little to
 * check — never a silent pass.
 *
 * `topFaceAtY`: a box centred at `at[1]` with height h has its top face at
 * `at[1] + h/2`. This is the rule kitten-survivors/types/ground.js states in
 * its own doc comment — the top face of the slab is the y = 0 plane every
 * other position in the level is measured from.
 */
const INVARIANT_RULES = {
  topFaceAtY: (declared, type, placement) => {
    const y = placement?.at?.[1]
    const height = placedHeight(type, placement)
    if (!Number.isFinite(y) || height == null) return null
    return { expected: declared.value, actual: y + height / 2 }
  }
}

/**
 * Every placement that breaks the invariant its type declares.
 *
 * Takes `levelPlacements` rather than reading it off `index`, because raw
 * placements are not kept on the index — see the comment where `buildIndex`
 * collects them. A level whose file failed to parse has no placements to
 * check and is skipped; `missingTypes` already reports a placement naming a
 * type that does not exist, so this only runs for placements whose type is
 * real.
 *
 * An unrecognised rule name and a placement `check` cannot compute from are
 * both reported as warnings — an invariant `check` cannot evaluate must say
 * so, not read as one that passed.
 */
export function invariantProblems(index, levelPlacements) {
  const out = []
  for (const [levelName, placements] of Object.entries(levelPlacements || {})) {
    const level = index.levels[levelName]
    if (!level || level.error) continue

    placements.forEach((placement, at) => {
      const typeName = placement?.type
      const type = typeName && index.types[typeName]
      const declared = type?.invariant
      if (!declared) return

      const named = `level "${levelName}" placement "${placement.id ?? `#${at}`}" (type "${typeName}")`
      const rule = INVARIANT_RULES[declared.rule]
      if (!rule) {
        out.push({
          file: type.file, warning: true,
          why: `type "${typeName}" declares invariant rule "${declared.rule}", which check does not know how to enforce`
        })
        return
      }

      const result = rule(declared, type, placement)
      if (!result || !Number.isFinite(result.expected) || !Number.isFinite(result.actual)) {
        out.push({
          file: level.file, warning: true,
          why: `${named} cannot be checked against its invariant "${declared.rule}" — not enough on the placement or its type to compute it`
        })
        return
      }

      const tolerance = Number.isFinite(declared.tolerance) ? declared.tolerance : 1e-6
      if (Math.abs(result.actual - result.expected) > tolerance) {
        out.push({
          file: level.file,
          why: `${named} breaks its invariant${declared.about ? ` — ${declared.about}` : ''} — expected ${result.expected}, got ${result.actual}`
        })
      }
    })
  }
  return out
}

/**
 * Is this tint white — the one value that multiplies nothing?
 *
 * Written as a hex string in a level and sometimes as a number in a type, so
 * both forms are read. Anything unreadable counts as not-white, because a tint
 * nobody can evaluate is exactly the one worth reporting.
 */
function tintIsWhite(tint) {
  if (typeof tint === 'number') return tint === 0xffffff
  const said = String(tint ?? '').trim().toLowerCase()
  return said === 'white' || said === '#fff' || said === '#ffffff'
}

/**
 * Every placement that draws a texture through a tint its type set.
 *
 * A placement's `mesh` merges over the type's key by key, so `tint` on a type is
 * not a fallback: it multiplies into every textured placement that did not state
 * its own. The level names no colour at all, so nothing in the file a reader
 * opens is wrong, and the only symptom is a frame that comes back the wrong
 * colour.
 *
 * A warning, not a failure. A type may be tinted on purpose, so the pair is a
 * strong smell rather than proof.
 *
 * One line per type and level with a count, the way a missing asset is reported:
 * a single type repaints hundreds of placements, and hundreds of identical lines
 * are worse than one.
 */
export function tintProblems(index, levelPlacements) {
  const out = []
  for (const [levelName, placements] of Object.entries(levelPlacements || {})) {
    const level = index.levels[levelName]
    if (!level || level.error) continue

    const hit = new Map()
    placements.forEach((placement, at) => {
      const type = index.types[placement?.type]
      if (!type || type.meshTint == null || tintIsWhite(type.meshTint)) return
      const mesh = placement?.mesh
      // A string mesh is the texture shorthand and states no tint either, so it
      // is caught by the same rule.
      const texture = typeof mesh === 'string' ? mesh : mesh?.texture
      if (!texture || (mesh && typeof mesh === 'object' && 'tint' in mesh)) return
      const seen = hit.get(placement.type)
        || { count: 0, first: placement.id ?? `#${at}`, tint: type.meshTint, typeFile: type.file }
      seen.count++
      hit.set(placement.type, seen)
    })

    for (const [typeName, seen] of hit) {
      const times = seen.count === 1 ? 'once' : `${seen.count} times`
      out.push({
        file: level.file,
        warning: true,
        why: `level "${levelName}" gives type "${typeName}" a textured mesh with no tint of its own ${times}` +
          ` (first "${seen.first}"), and the type declares mesh.tint ${JSON.stringify(seen.tint)}` +
          ` — a placement's mesh merges key by key, so that tint multiplies the texture on every one of them.` +
          ` State a tint on the placements, or take it off ${seen.typeFile}.`
      })
    }
  }
  return out
}
