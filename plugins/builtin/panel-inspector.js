/**
 * Inspector. One rule: it describes the current selection, whatever kind it is.
 * An entity shows placement and properties; a file shows kind, uses and used-by.
 * That is why the project browser never needed a detail pane of its own.
 *
 * Fields are generated from the type's `properties`, which is the only schema —
 * declared once, in code, with no separate serialisation annotation.
 */
const state = { plugin: null, guide: null, error: null }

export default {
  name: 'Inspector Panel',

  category: 'editor',
  onLoad(context) {
    context.bus.on('plugin:selected', plugin => inspectPlugin(context, plugin))
    context.bus.on('selection:changed', () => {
      if (state.plugin) { state.plugin = null; state.guide = null; context.redraw() }
    })
    context.bus.on('open:file', () => {
      state.plugin = null
      state.guide = null
    })
  },

  panels: [{
    id: 'inspector',
    title: 'Inspector',
    dock: 'right',
    order: 10,

    render(ui, context) {
      const sel = context.selection
      const file = context.editor._file

      if (state.plugin) return pluginView(ui, context)
      if (sel.length > 1) return multi(ui, context, sel)
      if (sel.length === 1) return entity(ui, context, sel[0])
      if (file) return fileView(ui, context, file)
      return ui.empty('select something in the scene, or open a file')
    }
  }]
}

async function inspectPlugin(context, plugin) {
  state.plugin = plugin
  state.guide = null
  state.error = null
  context.redraw()
  try {
    const guides = await context.files.agentPlugins()
    const guide = guides.find(g => g.plugin === plugin.name)
    if (!guide) return
    const text = await context.files.readAgent(guide.scope, guide.file)
    if (state.plugin?.name !== plugin.name) return
    state.guide = { ...guide, text, dirty: false }
  } catch (error) { state.error = String(error?.message || error) }
  context.redraw()
}

async function savePluginGuide(context) {
  if (!state.guide?.dirty) return
  await context.files.writeAgent(state.guide.scope, state.guide.file, state.guide.text)
  state.guide.dirty = false
  context.redraw()
}

/**
 * What one plugin is, and what it contributes — as lists, not form fields.
 * A command is its id and its label, a panel its title and dock, a system
 * its phase; each reads as a single truncated row, the same way the scene
 * and tests panels list things. A plugin may also export `about` for a
 * paragraph and `inspect` — data or a function of context — as sections of
 * { title, rows } rendered verbatim (CLI Surface lists its access points
 * that way).
 */
function pluginView(ui, context) {
  const plugin = state.plugin
  const def = (context.loader.plugins.get(plugin.name) || {}).definition || {}
  const inspect = typeof def.inspect === 'function' ? def.inspect(context) : (def.inspect || [])

  const facts = [
    { k: 'source', v: plugin.builtin ? 'built-in' : 'project' },
    { k: 'state', v: plugin.enabled ? 'enabled' : 'disabled' },
    ...(def.needs?.length ? [{ k: 'needs', v: def.needs.join(', ') }] : [])
  ]
  const lists = [
    ['Commands', def.commands, c => c.id, c => c.label],
    ['Panels', def.panels, p => p.title || p.id, p => p.dock ? `dock ${p.dock}` : ''],
    ['Systems', def.systems, s => s.phase, s => s.label || ''],
    ['Menus', def.menus, m => m.label || m.id, () => 'toolbar'],
    ['Tools', def.tools, t => t.id || t.label, t => t.label || '']
  ].filter(([, items]) => items?.length)
  const counted = [['fields', def.fields], ['importers', def.importers]].filter(([, items]) => items?.length)

  return ui.stack([
    ui.section(plugin.name, [
      ui.list({ items: facts, key: f => f.k, row: f => [ui.label(f.k), ui.spacer(), ui.meta(f.v)] }),
      plugin.error ? ui.field({ k: 'error', v: plugin.error, marked: true }) : null
    ].filter(Boolean)),
    def.about ? ui.section('About', [ui.text(def.about)]) : null,
    ...lists.map(([title, items, k, v]) => ui.section(title, [
      ui.list({ items, key: item => k(item), row: item => [ui.label(k(item)), ui.spacer(), ui.meta(v(item))] })
    ])),
    ...inspect.map(block => ui.section(block.title, [
      block.rows?.length
        ? ui.list({ items: block.rows, key: row => row[0], row: row => [ui.label(row[0]), ui.spacer(), ui.meta(row[1])] })
        : ui.text('nothing to show', { dim: true })
    ])),
    counted.length ? ui.section('Other', counted.map(([name, items]) => ui.text(`${name}: ${items.length}`, { dim: true }))) : null,
    ui.section('Agent guide', [
      state.error ? ui.text(state.error) : null,
      state.guide
        ? ui.stack([
            ui.text(state.guide.file, { dim: true }),
            ui.textarea({ value: state.guide.text, onChange: text => { state.guide.text = text; state.guide.dirty = true } }),
            ui.button(state.guide.dirty ? 'Save guide' : 'Guide saved', () => savePluginGuide(context), { primary: state.guide.dirty })
          ])
        : ui.text('reading guide…', { dim: true })
    ])
  ].filter(Boolean))
}

function entity(ui, context, e) {
  const set = (k, v) => {
    e[k] = v
    context.bus.emit('world:changed')
    context.save()
  }
  const setProp = (k, v) => {
    e.properties[k] = v
    if (!e.overrides.includes(k)) e.overrides.push(k)
    context.bus.emit('world:changed')
    context.save()
  }

  return ui.stack([
    ui.section(`${e.type} · entity`, [
      ui.field({ k: 'id', v: e.id })
    ]),
    ui.section('Placement', [
      ui.field({ k: 'x', v: round(e.x), kind: 'number', onChange: v => set('x', v) }),
      ui.field({ k: 'y', v: round(e.y), kind: 'number', onChange: v => set('y', v) }),
      ui.field({ k: 'rotation', v: round(e.rotation), kind: 'number', onChange: v => set('rotation', v) }),
      ui.field({ k: 'scale', v: round(e.scale), kind: 'number', onChange: v => set('scale', v) })
    ]),
    appearance(ui, context, e),
    behaviours(ui, context, e),
    Object.keys(e.properties).length && ui.section('Props', [
      ui.stack(Object.entries(e.properties).map(([k, v]) =>
        ui.field({
          k, v, kind: typeof v === 'number' ? 'number' : 'text',
          marked: e.overrides.includes(k),
          note: e.overrides.includes(k) ? 'set here' : null,
          onChange: nv => setProp(k, nv)
        })))
    ])
    // The link to the type file is in the What it is panel above, beside the
    // sentences the file holds. One link, in the place a reader is already
    // looking when they want the code.
  ].filter(Boolean))
}

/**
 * What this entity composes, and what each attachment is set to.
 *
 * Two things are said plainly here, because both are the kind of thing that
 * otherwise gets discovered by surprise: whether an attachment came from the
 * type or from this one placement, and which values were changed here. Both
 * are exactly what gets written back to the level.
 *
 * Attaching and detaching go through the public verbs rather than reaching
 * into the world, so the panel, the drop and the terminal all do the same
 * thing — and switching Behaviours off takes the buttons with it,
 * which is the plugin story working rather than failing.
 */
function behaviours(ui, context, e) {
  const attached = e.behaviours || []
  const spare = context.behaviours().map(b => b.name).filter(n => !attached.some(b => b.name === n))
  if (!attached.length && !spare.length) return null

  const verb = (id, args) => {
    try { context.run(id, args) } catch (err) { console.error(`[inspector] ${err.message}`) }
  }

  const block = record => {
    if (record.error) return ui.field({ k: record.name, v: record.error, marked: true })

    const declared = Object.keys(record.definition.properties || {})
    const running = Object.keys(record.bag).filter(k => !declared.includes(k))

    return ui.stack([
      ui.row([
        ui.label(record.name),
        ui.meta(record.own ? 'added here' : 'from the type'),
        ui.spacer(),
        ui.button('detach', () => verb('behaviour.detach', [e.id, record.name]))
      ]),
      ...declared.map(k => ui.field({
        k,
        v: record.bag[k],
        kind: typeof record.definition.properties[k] === 'number' ? 'number' : 'text',
        marked: record.overrides.includes(k),
        note: record.overrides.includes(k) ? 'set here' : null,
        onChange: v => {
          context.world.setBehaviourProp(e, record.name, k, v)
          context.save()
          context.redraw()
        }
      })),
      // State the behaviour keeps in its own bag. Read-only: writing a value
      // from the middle of a run into the level would record a freeze-frame
      // as if it were a decision.
      ...running.map(k => ui.field({ k, v: String(record.bag[k]), note: 'runtime' }))
    ])
  }

  return ui.section('Behaviours', [
    attached.length ? ui.stack(attached.map(block)) : ui.text('none attached', { dim: true }),
    // Named, because a bare row of buttons under a "detach" button reads as
    // "which one of these am I already using?" rather than "add one of these".
    spare.length ? ui.text('attach', { dim: true }) : null,
    spare.length ? ui.pick({
      options: spare,
      onChange: n => verb('behaviour.attach', [e.id, n])
    }) : null
  ].filter(Boolean))
}

/**
 * What this entity looks like, and how to change it.
 *
 * The image name is a plain text field rather than a picker: the project is
 * depth 1, the names are short, and typing one is faster than opening a modal.
 * The list of what is available is one panel away in the project browser.
 */
function appearance(ui, context, e) {
  const sprite = e.sprite || {}
  const images = context.assets('image').map(a => a.name)

  // A sprite is one picture (`image`) or a strip of frames (`sheet`). Whichever
  // it is, the field edits the key that is actually set, so typing a new name
  // never silently converts a sheet into a single image.
  const key = sprite.sheet ? 'sheet' : 'image'
  const src = sprite.sheet || sprite.image

  const write = (k, v) => {
    e.sprite = { ...sprite, [k]: v }
    if (!e.sprite.image && !e.sprite.sheet) e.sprite = null   // cleared: back to the tint
    context.bus.emit('world:changed')
    context.save()
    context.redraw()
  }

  const missing = src && !images.includes(src.split('/').pop())
  const clips = e._definition.animation ? Object.keys(e._definition.animation) : []

  return ui.section('Appearance', [
    src ? ui.preview({ file: src }) : null,
    ui.field({
      k: key,
      v: src || '',
      note: missing ? 'not in assets' : src ? null : `${images.length} available`,
      marked: !!missing,
      onChange: v => write(key, v.trim())
    }),
    sprite.sheet && ui.field({
      k: 'cell', v: (sprite.size || []).join(' × ') || '', note: 'pixels per frame'
    }),
    sprite.sheet && ui.field({ k: 'frame', v: e.frame ?? 0, note: e.animation || null }),
    clips.length && ui.field({ k: 'animation', v: clips.join(' '), note: 'from the type' }),
    src && ui.field({
      k: 'width', v: sprite.width ?? '', kind: 'number',
      note: sprite.width == null ? 'from collider' : null,
      onChange: v => write('width', v || null)
    }),
    src && ui.field({
      k: 'height', v: sprite.height ?? '', kind: 'number',
      note: sprite.height == null ? 'from collider' : null,
      onChange: v => write('height', v || null)
    }),
    src && ui.field({
      // Only the unusual state is annotated: the accent means "changed", and
      // labelling the normal case spends it on nothing.
      k: 'tile', v: sprite.tile ?? '', kind: 'number',
      note: sprite.tile ? 'repeats per unit' : null,
      onChange: v => write('tile', v || null)
    })
  ].filter(Boolean))
}

function multi(ui, context, sel) {
  const kinds = [...new Set(sel.map(e => e.type))]
  return ui.stack([
    ui.section(`${sel.length} selected`, [
      ui.field({ k: 'kinds', v: kinds.join(', ') })
    ]),
    ui.row([
      ui.button('Delete', () => { sel.forEach(e => context.destroy(e)); context.save(); context.redraw() })
    ], { pad: true })
  ])
}

function fileView(ui, context, f) {
  const chips = (arr, empty) =>
    (arr && arr.length)
      ? ui.pick({ options: arr, onChange: () => {} })
      : ui.text(empty, { dim: true })

  return ui.stack([
    ui.section(`${f.name} · ${f.kind}`, [ui.field({ k: 'path', v: f.file })]),
    (f.kind === 'image' || f.kind === 'sound') && ui.preview(f),
    f.properties?.length && ui.section('Props', [chips(f.properties, '—')]),
    f.hooks?.length && ui.section('Hooks', [chips(f.hooks, 'none')]),
    f.types?.length && ui.section('Contains', [chips(f.types, 'empty level')]),
    f.uses?.length && ui.section('Uses', [chips(f.uses, 'no assets')]),
    (f.kind !== 'level') && ui.section('Used by', [
      chips(f.usedBy, 'nothing references this')
    ])
  ].filter(Boolean))
}

const round = n => Math.round((n ?? 0) * 1000) / 1000
