/**
 * Kernel: the snapshot projection.
 *
 * `engine.snapshot()` answers what the world holds right now, summarised by
 * default and detailed on request — a full entity dump every time would be the
 * expensive thing to read. Everything here turns the live world, loop, editor
 * and log into that reply, and projects one entity into its view.
 */
import { round3 } from './round3.js'
import { stateHash } from './world.js'
import { reasonFor } from './log.js'

/**
 * Add the reload note to a reply, once.
 *
 * A page reload rebuilds the world. Unreported, an agent keeps reading the
 * new world as the old one. The field is named for the outcome —
 * `worldWasRestored` or `worldWasReset` — and is absent when there is
 * nothing to report, so it never becomes noise.
 */
export function note(reload, out) {
  const said = reload?.()
  if (said) out[said.key] = said.sentence
  return out
}

/** A reply with room for one more key: a plain object, not a number or a list. */
export function plainReply(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
}

/**
 * The columns one row of a bulk entity list can carry.
 *
 * Named here rather than discovered from the first row, so a projection can refuse a
 * field that does not exist instead of answering with a column of nulls — which reads
 * as a world where nothing has a rotation.
 */
const ENTITY_COLUMNS = ['id', 'type', 'at', 'rotation', 'note', 'properties', 'behaviours']

/**
 * Rows as columns: the field names once, then one array per row.
 *
 * A dump of four hundred and forty entities is 22 KB as rows of objects and 14 KB as
 * columns, because the names are a third of it. The projection is the larger half —
 * the same dump of `id` and `at` is 9 KB — and it is the same data, so a caller that
 * asks for two columns gets two columns rather than reading seven and discarding five.
 *
 * @param {object[]} rows One object per row.
 * @param {string[]} fields Which of its fields to keep, in this order.
 * @returns {object} `{ columns, rows }`.
 */
export const asColumns = (rows, fields) => ({
  columns: fields,
  rows: rows.map(row => fields.map(field => row[field]))
})

/**
 * The fields a projection named, checked.
 *
 * @param {string|string[]} asked Field names, or one string of them separated by commas.
 * @param {string[]} known Every field this reply's rows can carry.
 * @returns {string[]} The names, in the order asked for.
 * @throws When a name is not a field of this row, naming the ones that are.
 */
export function wantedFields(asked, known) {
  const fields = (Array.isArray(asked) ? asked : String(asked).split(','))
    .map(field => String(field).trim())
    .filter(Boolean)
  if (!fields.length) throw new Error(`name the fields to keep, separated by commas — this row carries ${known.join(', ')}`)
  const wrong = fields.filter(field => !known.includes(field))
  if (wrong.length) throw new Error(`no field "${wrong.join('", "')}" — this row carries ${known.join(', ')}`)
  return fields
}

/** The type definition behind an entity, or an empty one. */
function definitionOf(entity) {
  return entity._definition || {}
}

/** What the author wrote this type IS, for a single-entity reply. */
function describedFields(definition) {
  const out = {}
  if (definition.about) out.about = definition.about
  if (definition.appearance) out.appearance = definition.appearance
  if (definition.looksWrongWhen) out.looksWrongWhen = definition.looksWrongWhen
  return out
}

/** The fields every entity reply carries. */
function entityBase(entity) {
  return {
    id: entity.id, type: entity.type,
    at: [round3(entity.x), round3(entity.y), round3(entity.z)],
    ...(entity.rotation ? { rotation: round3(entity.rotation) } : {}),
    // Why this one is placed here. In a bulk list it is the only description
    // that appears, and only on the placements that wrote one — what the type
    // IS is said once per type, not once per entity.
    ...(entity.note ? { note: entity.note } : {})
  }
}

/** The trimmed fields a bulk reply carries. */
function bulkView(entity, out) {
  // In bulk, properties IS the override list — naming the keys twice is waste.
  if (entity.overrides.length) {
    out.properties = Object.fromEntries(entity.overrides.map(key => [key, entity.properties[key]]))
  }
  // Names only. What each one holds is in the index, once, rather than
  // repeated on every entity that attached it.
  if (entity.behaviours.length) out.behaviours = entity.behaviours.map(behaviour => behaviour.name)
  return out
}

/** The complete fields a single-entity reply carries. */
function fullView(entity, out) {
  // What the author wrote this type IS, read through the definition rather than
  // copied onto the entity, so editing the type file reaches every live entity
  // with nothing to re-sync. Identity comes before the numbers because a reader
  // has to know what the thing is to read them.
  Object.assign(out, describedFields(definitionOf(entity)))
  out.properties = entity.properties
  if (entity.overrides.length) out.overrides = entity.overrides
  if (entity.behaviours.length) {
    out.behaviours = Object.fromEntries(entity.behaviours.map(behaviour =>
      [behaviour.name, behaviour.error ? { error: behaviour.error } : behaviour.bag]))
  }
  return out
}

/**
 * One entity as a reply.
 *
 * `bulk` trims properties to the overridden ones. In a list of fifty entities the
 * type defaults are the same fifty times and are already in the index, so
 * repeating them is the single most wasteful thing this surface can do.
 * A single-entity lookup is cheap, so that one stays complete.
 */
export function entityView(e, bulk = false) {
  const out = entityBase(e)
  return bulk ? bulkView(e, out) : fullView(e, out)
}

/** Every plugin, by name where it has one and by file where it never loaded. */
function pluginList(loader) {
  return [...loader.plugins.entries()].map(([name, plugin]) => (plugin.file
    // A file that never imported has no name to show. Say what it is
    // instead of printing a path where a name belongs.
    ? { file: plugin.file, loaded: false, builtin: plugin.builtin, error: plugin.error }
    : { name, enabled: plugin.enabled, error: plugin.error }))
}

/** The entity rows a caller asked for, as rows or as columns. */
function entityRows(world, options) {
  const rows = world.entities.map(entity => entityView(entity, true))
  return options.entities === true ? rows : asColumns(rows, wantedFields(options.entities, ENTITY_COLUMNS))
}

/** The extra sections a caller asked for by name. */
function detailFields(out, options, { loader, loop, log }) {
  if (options.plugins) out.plugins = pluginList(loader)
  if (options.log) out.log = log.lines.slice(-40)
  if (options.timers) out.timers = loop.timers
  if (options.commands) out.commands = loader.contrib.commands.map(command => command.id)
}

/**
 * The world as `snapshot()` answers it.
 *
 * Compact by default. Pass `{ entities: true, log: true, plugins: true }` for detail.
 *
 * `entities` may also name the fields to keep — `{ entities: ['id', 'at'] }` — and
 * the reply comes back as columns: the names once, then one array per entity. Same
 * world, a fifth of the reading.
 */
export function projectSnapshot({ world, loader, loop, files, editor, view, log, reload }, options = {}) {
  // `snapshot --entities id,at` reaches here as a string first argument, because
  // the flag parser keeps a bare flag boolean on purpose. Answering the compact
  // reply then reads as the projection having done nothing.
  if (typeof options !== 'object' || options === null) {
    throw new Error(`snapshot takes an options object — for some fields as columns: snapshot '{"entities":["id","at"]}'`)
  }
  const types = [...world.types.keys()]
  const broken = loader.failures()
  const out = {
    mode: loop.running ? 'play' : 'edit',
    // Which project answered. A command that omits `--project` opens the
    // default one and says nothing, so a reply about the wrong game reads
    // exactly like a reply about the right one.
    project: editor.projectName,
    level: editor.levelName,
    // Engine time and seed, because "what happened" is only reproducible
    // if you know where the clock and the random stream were.
    time: round3(loop.time),
    // Only when something is holding time still. "Nothing is moving" is the
    // hardest thing to diagnose without being told who asked for that.
    ...(loop.paused ? { paused: loop.holds } : {}),
    seed: loop.random.seed,
    // One value that changes whenever the world does. Two runs are compared
    // by this rather than by reading a thousand entities: it is what answers
    // whether a change altered the simulation at all, and it is what makes a
    // rewind or a restored world checkable. See `stateHash` in world.js.
    hash: stateHash(world),
    camera: { x: round3(view.x), y: round3(view.y), zoom: round3(view.zoom), mode: view.mode },
    counts: {
      entities: world.entities.length,
      types: types.length,
      behaviours: world.behaviours.size,
      plugins: [...loader.plugins.values()].filter(p => p.enabled).length
    },
    selection: [...editor.selection],
    byType: types.reduce((a, t) => (a[t] = world.all(t).length, a), {}),
    errors: log.lines.filter(l => l.level === 'error').slice(-5),
    // Its own key, not a line in the error ring, because the ring keeps the
    // last five and a broken plugin must not be pushed out of the summary
    // by five later complaints. Absent when everything loaded, so the
    // healthy snapshot is the size it always was.
    ...(broken.length ? { pluginsFailed: broken.map(reasonFor) } : {}),
    // A refused write leaves nothing pending, so the count alone reads as
    // saved. Both halves are needed for `unsaved` to be true.
    unsaved: files.pending > 0 || !!files.refused,
    ...(files.refused ? { refused: files.refused.message } : {})
  }
  if (options.entities) out.entities = entityRows(world, options)
  detailFields(out, options, { loader, loop, log })
  return note(reload, out)
}
