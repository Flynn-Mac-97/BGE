/**
 * Object Descriptions — what a thing IS, written by the author, read by anyone.
 *
 * An agent looking at a game can measure everything about an object except its
 * identity: a name, a box, a colour and a position do not say what a thing is
 * for. Three strings on the type answer that, written once at authoring time:
 *
 *   about           what it is and what it does, under 100 characters
 *   appearance      how a CORRECT one reads on screen, under 200
 *   looksWrongWhen  how a BROKEN one reads, and what is broken, under 200
 *
 * All three are plain keys on the type's default export, above `mesh`. They are
 * kernel data, not a contribution of this plugin: `engine.entity`, the project
 * index, `see.describe` and `see.isolate` all answer with this plugin disabled.
 * This plugin owns the two verbs, `description.record`, and the panel, and owns
 * none of the type or entity data.
 *
 * A placement carries a fourth string, `note`, saying why THIS one is here. It
 * adds to what the type says and never restates it, because the sidecar legend
 * says a type's identity once and that has to stay true.
 *
 * `appearance` is prose, checked against nothing by default — a fact this file
 * says on every reply. `description.record` closes part of that gap: it writes
 * down the tint, model, texture and box a description was written against, in
 * `<project>/description-basis.json`. Every later `description` and
 * `description.missing` compares the type's CURRENT art against that record and
 * reports `stale` only when the two disagree — never when nothing was ever
 * recorded, because a warning with no baseline is a guess wearing a badge.
 *
 * A type a running world actually holds may never reach `world.types` at all —
 * a projectile spawned straight from a placement's mesh and properties has no
 * file and no plugin registration behind it. `description` and
 * `description.missing` both look at the live entities too, and say plainly
 * that nothing can be written for one of these until it gets a real
 * registration. Particles, decals and damage numbers go further still: they
 * are never entities and carry no id, and `description` says so by name rather
 * than answering "no entity" to a question that was never about one.
 */

/** Caps, reported and never enforced. Nothing here cuts an author's sentence. */
const CAPS = { about: 100, appearance: 200, looksWrongWhen: 200 }

/** Said on every reply, because an authored sentence reads like a measured one. */
const AUTHORED = 'written by the author, not measured. Compare it against see.capture; '
  + 'where the picture disagrees, that disagreement is the finding.'

/** Where the recorded basis lives — a project file, committed, same as views.json. */
const BASIS_FILE = 'description-basis.json'

/** What every type's description was last written against, keyed by type name. */
async function readBasis(context) {
  try { return JSON.parse(await context.files.read(BASIS_FILE)) } catch { return {} }
}

async function writeBasis(context, basis) {
  await context.files.writeJSON(BASIS_FILE, basis)
}

/**
 * Things on screen with no id and no entity behind them. Nothing can look one
 * up by "of" and no verb should answer as if it might — a bare "no entity"
 * error here would read as "try a different id" when no id will ever work.
 */
const NOT_ENTITIES = {
  particle: 'a particle effect (Particles) — a burst, trail or drifting cloud, drawn straight from the '
    + 'particle field. It is never spawned and carries no id.',
  decal: 'a decal (Decals) — a mark stuck to a surface. It is never spawned and carries no id.',
  'damage number': 'a damage number (Damage Numbers) — the figure that lifts off a hit and fades. '
    + 'It is never spawned and carries no id.'
}

/** "decal-7", "Decals" and "damage-numbers" all read as the same key as "decal". */
function stripId(name) {
  return String(name).trim().toLowerCase()
    .replace(/-\d+$/, '')
    .replace(/-/g, ' ')
    .replace(/s$/, '')
}

/** What `name` is, when it names a non-entity effect rather than a typo or a real type. */
function notAnEntity(name) {
  return NOT_ENTITIES[stripId(name)] || null
}

/** A plain string sprite means { image: <that string> }, same as a placement's. */
const asImage = value => (typeof value === 'string' ? { image: value } : (value || {}))

/**
 * The facts a description is written against: enough to say the art changed
 * under it. Not the whole type — properties and behaviour are not "how it
 * looks", and copying them here would make this its own stale copy.
 */
function visualFacts(definition = {}) {
  const mesh = definition.mesh || {}
  const sprite = asImage(definition.sprite)
  const facts = { tint: mesh.tint, model: mesh.model, texture: mesh.texture, box: mesh.box, image: sprite.image }
  return Object.fromEntries(Object.entries(facts).filter(([, value]) => value !== undefined))
}

/** Which keys differ between a recorded basis and the current facts, and how. */
function changedFacts(recorded, current) {
  const changed = {}
  for (const key of new Set([...Object.keys(recorded), ...Object.keys(current)])) {
    if (JSON.stringify(recorded[key]) !== JSON.stringify(current[key])) {
      changed[key] = { was: recorded[key] ?? null, now: current[key] ?? null }
    }
  }
  return changed
}

/** Where a type is written, as a path from the checkout root. */
function writtenIn(context, type) {
  const entry = context.editor.index?.types?.[type]
  return entry?.file ? `${context.editor.projectDirectory}/${entry.file}` : null
}

/** The authored strings a type carries, in reading order, absent ones omitted. */
function written(definition = {}) {
  const out = {}
  for (const field of Object.keys(CAPS)) if (definition[field]) out[field] = definition[field]
  return out
}

/**
 * What one type is, and where to go if nobody has said.
 *
 * Read from `world.types` and, when nothing is registered there, from the
 * live entities a running world actually holds — a type spawned straight from
 * a placement (a projectile, with no file and no plugin registration) never
 * reaches `world.types`, and is exactly the kind of thing an agent meets
 * mid-run and cannot name otherwise. A hot swap moves a registered definition
 * and the next call reads the new sentences either way.
 */
async function description(context, options = {}) {
  const entity = options.of ? context.world.byId(options.of) : null
  if (options.of && !entity) {
    const guess = notAnEntity(options.of)
    return guess ? { of: options.of, notAnEntity: true, about: guess } : { error: `no entity "${options.of}"` }
  }

  const type = entity ? entity.type : options.type
  if (!type) return { error: 'name an entity with `of`, or a type with `type`' }

  const head = { ...(entity ? { id: entity.id } : {}), type }
  const definition = context.world.types.get(type)
  const file = writtenIn(context, type)

  // No registered definition at all. Either there is a file that failed to
  // load, or "type" was never a type — it is a non-entity effect, or a live
  // entity spawned with nothing behind it.
  if (!definition) {
    if (file) return { error: `"${type}" has a file (${file}) but is not a registered type — check the log for why it failed to load` }

    const guess = notAnEntity(type)
    if (guess) return { ...head, notAnEntity: true, about: guess }

    if (context.world.all(type).length) {
      return {
        ...head,
        undescribed: true,
        runtimeOnly: true,
        hint: `"${type}" is spawned at runtime with no type file and no plugin registration, so nothing holds `
          + `about, appearance or looksWrongWhen for it yet. Describe it in whichever plugin calls `
          + `world.spawn("${type}", …), or give it a real type file.`
      }
    }
    return { error: `no type "${type}"` }
  }

  const said = written(definition)

  // Naming the file and the three questions is the whole answer when nothing is
  // written. Guessing from the name is what this plugin exists to stop.
  if (!said.about) {
    return {
      ...head,
      undescribed: true,
      writtenIn: file,
      ...(file ? {} : { registeredBy: 'a plugin at load time — this project has no file for it' }),
      hint: file
        ? `no about on this type. Read ${file}, write about, appearance and looksWrongWhen, `
          + 'and every agent after you is told instead of guessing.'
        : `no about on this type. It is registered by a plugin rather than written in ${context.editor.projectDirectory}, `
          + 'so the plugin that registers it is where the three sentences go.'
    }
  }

  const basis = await readBasis(context)
  const drift = basis[type] ? changedFacts(basis[type], visualFacts(definition)) : null
  const stale = drift && Object.keys(drift).length ? drift : null

  return {
    ...head,
    ...said,
    ...(entity?.note ? { note: entity.note } : {}),
    writtenIn: file,
    ...(file ? {} : { registeredBy: 'a plugin at load time — this project has no file for it' }),
    ...(stale ? {
      stale: {
        changed: Object.keys(stale).sort(),
        ...stale,
        hint: 'the art changed since description.record last ran on this type. Compare appearance against '
          + 'see.capture and rewrite it, or run description.record again if the prose still holds.'
      }
    } : {}),
    authored: AUTHORED
  }
}

/**
 * The backfill worklist.
 *
 * Reported per FIELD, not per type. The realistic shortfall is every type
 * carrying `about` and none carrying the other two, and a per-type count hides
 * exactly that. Run it until every list is empty; a non-empty `looksWrongWhen`
 * is unfinished work.
 *
 * Types come from `world.types` AND the live entities a running world actually
 * holds — the second source is why `simulate` before this call can change the
 * answer. A type spawned straight from a placement never registers itself, so
 * a level's own types are all this saw before anything played.
 */
async function missing(context) {
  const registered = context.world.types
  const runtimeOnly = [...new Set(context.world.entities.map(e => e.type))]
    .filter(name => !registered.has(name))
    .sort()

  const types = [...registered.entries(), ...runtimeOnly.map(name => [name, {}])]
  const lists = { about: [], appearance: [], looksWrongWhen: [] }
  const tooLong = []
  const stale = []
  const basis = await readBasis(context)
  let described = 0
  let notes = 0

  for (const [name, definition] of types) {
    const said = written(definition)
    if (said.about) described++
    for (const [field, cap] of Object.entries(CAPS)) {
      if (!said[field]) lists[field].push(name)
      else if (said[field].length > cap) tooLong.push({ type: name, field, characters: said[field].length, cap })
    }
    if (basis[name]) {
      const drift = changedFacts(basis[name], visualFacts(definition))
      if (Object.keys(drift).length) stale.push({ type: name, changed: Object.keys(drift).sort() })
    }
  }
  for (const entity of context.world.entities) if (entity.note) notes++

  for (const list of Object.values(lists)) list.sort()
  tooLong.sort((a, b) => (a.type < b.type ? -1 : a.type > b.type ? 1 : 0))

  return {
    types: types.length,
    described,
    missing: lists,
    tooLong,
    // Types nothing ever registered — no file, no plugin call. Empty most of
    // the time; a level that has not played anything spawns none of these.
    runtimeOnly,
    // Types whose recorded basis disagrees with their current art right now.
    stale,
    notes,
    note: 'a type with no about is a type the next agent has to reverse-engineer '
      + 'from the name, the code and the pixels'
  }
}

/**
 * Record what a type's description is written against, so a later change to
 * the art is caught as drift instead of going unnoticed. Refuses a type with
 * no `about` yet — there is no prose for a recorded basis to protect.
 */
async function record(context, options = {}) {
  const type = options.type
  if (!type) return { error: 'name a type: description.record {"type":"rat"}' }

  const definition = context.world.types.get(type)
  if (!definition) return { error: `no type "${type}"` }
  if (!written(definition).about) {
    return { error: `"${type}" has no about yet — write about, appearance and looksWrongWhen first, then record what they were written against` }
  }

  const basis = await readBasis(context)
  basis[type] = visualFacts(definition)
  await writeBasis(context, basis)
  return { type, recorded: basis[type] }
}

export default {
  name: 'Object Descriptions',

  category: 'agents',
  about: 'What each object is, by type and placement.',

  commands: [
    {
      id: 'description',
      label: 'Author\'s description',
      run: (context, options) => description(context, options || {})
    },
    {
      id: 'description.missing',
      label: 'Missing descriptions',
      run: context => missing(context)
    },
    {
      id: 'description.record',
      label: 'Description facts',
      run: (context, options) => record(context, options || {})
    }
  ],

  panels: [{
    id: 'object-description',
    title: 'What it is',
    dock: 'right',
    order: 5,
    // One selection, one identity. Two things selected is a question about the
    // level, and the Inspector below already answers that one.
    when: context => context.selection.length === 1,

    render(ui, context) {
      const entity = context.selection[0]
      const said = written(entity._definition || {})

      // The three type strings are read-only here. The Inspector edits the
      // level, never the code; the file link is how you reach the code. The
      // empty state names all three, because the two nobody is motivated to
      // write are the two that answer "why is this a featureless block".
      const rows = Object.keys(said).length
        ? [
            ...(said.about ? [ui.text(said.about)] : []),
            ...(said.appearance ? [ui.text('On screen', { dim: true }), ui.text(said.appearance)] : []),
            ...(said.looksWrongWhen ? [ui.text('Looks wrong when', { dim: true }), ui.text(said.looksWrongWhen)] : [])
          ]
        : [ui.text(`not described — write about, appearance and looksWrongWhen in types/${entity.type}.js`, { dim: true })]

      return ui.stack([
        ui.section(`${entity.type} · what it is`, [
          ui.raw(fileLink(`types/${entity.type}.js`, () => context.open(`types/${entity.type}.js`))),
          ...rows
        ]),
        ui.section('Why this one is here', [
          ui.textarea({
            value: entity.note || '',
            placeholder: 'what this placement adds that its type does not say',
            onChange: text => {
              entity.note = text.trim() || null
              context.bus.emit('world:changed')
              context.save()
            }
          })
        ])
      ])
    }
  }]
}

/** A path that opens the file, drawn as a button because that is what it is. */
function fileLink(text, onClick) {
  const button = document.createElement('button')
  button.textContent = `${text} →`
  button.className = 'u-btn'
  button.style.margin = '2px 0 6px'
  button.onclick = onClick
  return button
}
