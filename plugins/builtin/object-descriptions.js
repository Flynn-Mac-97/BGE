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
 * This plugin owns the two verbs and the panel, and owns none of the data.
 *
 * A placement carries a fourth string, `note`, saying why THIS one is here. It
 * adds to what the type says and never restates it, because the sidecar legend
 * says a type's identity once and that has to stay true.
 *
 * Every reply says the sentences are authored. They are not measured, nothing
 * checks them against the picture, and a stale one is confident and wrong — so
 * running `description` and `see.capture` on the same type and reporting the
 * disagreement is the workflow these verbs exist to make possible.
 */

/** Caps, reported and never enforced. Nothing here cuts an author's sentence. */
const CAPS = { about: 100, appearance: 200, looksWrongWhen: 200 }

/** Said on every reply, because an authored sentence reads like a measured one. */
const AUTHORED = 'written by the author, not measured. Compare it against see.capture; '
  + 'where the picture disagrees, that disagreement is the finding.'

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
 * Read from `world.types`, so it answers headless, in the browser, with no
 * renderer, and with whatever the type file says right now — a hot swap moves
 * the definition and the next call reads the new sentences.
 */
function description(context, options = {}) {
  const entity = options.of ? context.world.byId(options.of) : null
  if (options.of && !entity) return { error: `no entity "${options.of}"` }

  const type = entity ? entity.type : options.type
  if (!type) return { error: 'name an entity with `of`, or a type with `type`' }

  const definition = context.world.types.get(type)
  if (!definition) return { error: `no type "${type}"` }

  const file = writtenIn(context, type)
  const said = written(definition)
  const head = { ...(entity ? { id: entity.id } : {}), type }

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

  return {
    ...head,
    ...said,
    ...(entity?.note ? { note: entity.note } : {}),
    writtenIn: file,
    ...(file ? {} : { registeredBy: 'a plugin at load time — this project has no file for it' }),
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
 */
function missing(context) {
  const types = [...context.world.types.entries()]
  const lists = { about: [], appearance: [], looksWrongWhen: [] }
  const tooLong = []
  let described = 0
  let notes = 0

  for (const [name, definition] of types) {
    const said = written(definition)
    if (said.about) described++
    for (const [field, cap] of Object.entries(CAPS)) {
      if (!said[field]) lists[field].push(name)
      else if (said[field].length > cap) tooLong.push({ type: name, field, characters: said[field].length, cap })
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
    notes,
    note: 'a type with no about is a type the next agent has to reverse-engineer '
      + 'from the name, the code and the pixels'
  }
}

export default {
  name: 'Object Descriptions',

  about: 'What each object IS, written on its type and read by every agent surface — '
    + 'about, appearance and looksWrongWhen on a type, and a note on one placement.',

  commands: [
    {
      id: 'description',
      label: 'What the author says a thing is, what a correct one looks like, and what a broken one looks like',
      run: (context, options) => description(context, options || {})
    },
    {
      id: 'description.missing',
      label: 'Which types have no about, appearance or looksWrongWhen yet — the backfill worklist',
      run: context => missing(context)
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
