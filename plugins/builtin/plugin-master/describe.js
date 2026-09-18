/**
 * A plugin's description, derived from what it declares.
 *
 * The prose stays the author's: a guide says why a thing exists and when to
 * reach for it, and no reader can write that. Everything mechanical is here
 * instead — what it contributes, what it puts on context, what it listens for —
 * so a surface never shows a blank line and no author keeps a second copy of
 * the same facts in step with the code.
 *
 * One shape, two routes to it: `source-facts.js` reads a file, and
 * `factsOfDefinition` reads a plugin that is already loaded. The browser holds
 * every definition and needs no parser; the terminal reads source so it can
 * describe a plugin that will not even load.
 */

/**
 * The contribution points, in the order the loader declares them.
 *
 * The order is imposed here rather than taken from the facts object: the source
 * reader builds its keys in this order and a loaded definition builds them in
 * another, so a description would otherwise word one plugin two ways depending
 * on which route asked.
 */
const POINTS = ['panels', 'tools', 'commands', 'fields', 'importers', 'systems', 'menus']

/** `commands` → `command`, for a count of one. */
const PLURAL = { commands: 'command', panels: 'panel', tools: 'tool', fields: 'field', importers: 'importer', systems: 'system', menus: 'menu' }

/** `2 commands`, `1 panel`. */
const counted = (point, count) => `${count} ${count === 1 ? PLURAL[point] : point}`

/**
 * One line naming what a plugin contributes, near-empty for one that declares
 * only behaviour.
 *
 * Order is fixed so two runs and two halves cannot word the same plugin
 * differently: what it provides, what it fills, what it adds, what it answers.
 */
export function summaryOf(facts = {}) {
  const clauses = []
  if (facts.provides?.length) clauses.push(`provides ${facts.provides.join(', ')}`)
  const points = POINTS
    .filter(point => (facts.contributes || {})[point] > 0)
    .map(point => counted(point, facts.contributes[point]))
  if (points.length) clauses.push(points.join(', '))
  if (facts.context?.length) clauses.push(`adds ${facts.context.map(key => `context.${key}`).join(', ')}`)
  if (facts.systems?.length) clauses.push(`${facts.systems.join(' and ')} each step`)
  if (facts.listens?.length) clauses.push(`listens for ${facts.listens.join(', ')}`)
  if (facts.emits?.length) clauses.push(`emits ${facts.emits.map(entry => entry.event).join(', ')}`)
  const head = facts.category || 'plugin'
  return clauses.length
    ? `${head}: ${clauses.join('. ')}.`
    : `${head}: no contribution point; read its guide.`
}

/**
 * The short index line for one entry of the whole list.
 *
 * A list of every plugin is read to find one, and the authored `about` is what
 * that reader matches on. The full {@link summaryOf} line adds the category and
 * interface detail — systems, listeners, emitted events — that
 * `plugin.facts '{"plugin":"<name>"}'` answers anyway. This line keeps only what
 * the plugin provides and its contribution points, so the list stays an index
 * and the single-plugin answer keeps everything.
 */
export function listLineOf(facts = {}) {
  const head = facts.category || 'plugin'
  const parts = []
  if (facts.provides?.length) parts.push(facts.provides.join(', '))
  // A count of one is the point's own name: `panel` says as much as `1 panel`,
  // and this line is read once per plugin in a list of every plugin.
  const points = POINTS
    .filter(point => (facts.contributes || {})[point] > 0)
    .map(point => facts.contributes[point] === 1 ? PLURAL[point] : `${facts.contributes[point]} ${point}`)
  if (points.length) parts.push(points.join(' '))
  return parts.length ? parts.join(' ') : head
}

/**
 * The same facts from a plugin the loader already holds.
 *
 * A definition cannot say what a command's body does, so the two fields only
 * source can answer — whether a command refuses without a host, and which
 * events it emits with what payload — are absent rather than empty here.
 *
 * @param {object} definition A plugin's default export.
 * @returns {object} Facts in the shape {@link summaryOf} reads.
 */
export function factsOfDefinition(definition = {}) {
  const contributes = {}
  for (const point of Object.keys(PLURAL)) {
    const count = (definition[point] || []).length
    if (count) contributes[point] = count
  }
  return {
    name: definition.name ?? null,
    category: definition.category ?? null,
    about: definition.about || null,
    lifecycle: definition.lifecycle || 'legacy',
    contributes,
    commands: (definition.commands || []).map(command => ({ id: command.id, label: command.label, key: command.key || null })),
    systems: (definition.systems || []).map(system => system.phase).filter(Boolean),
    provides: definition.provides || [],
    requires: definition.requires || [],
    needs: definition.needs || [],
    context: [],
    listens: [],
    emits: []
  }
}
