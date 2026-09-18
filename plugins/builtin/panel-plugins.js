/**
 * Plugin Browser — what the engine is made of, and a switch for each part.
 *
 * The claim "everything except the kernel is a plugin" is only useful if you can
 * see it. This lists every plugin, what each one contributes, and lets you turn
 * it off and watch the editor lose that piece — the inspector, physics, the
 * transform gizmo. It is the fastest way to understand the shape of the thing.
 *
 * Opened from the toolbar rather than living in a dock: you look at it when you
 * are changing what the engine does, which is not most of the time.
 *
 * Which plugins are off is stored in `project/game.json`, because it is a
 * property of the project rather than of this browser.
 */
const state = { open: false, selected: null }

/**
 * The categories, in reading order, with the one line each that says what the
 * group is for.
 *
 * Five, deliberately. A list of sixty-five names in load order tells a newcomer
 * nothing about which one answers their question, and thirty categories would
 * be the same problem again. `game` is separate because those are the ones most
 * likely to leave the engine.
 *
 * A plugin declares `category` beside its `name`. One that declares none is
 * listed last under "uncategorised" rather than hidden.
 */
const CATEGORIES = [
  ['engine', 'Engine', 'The world runs: bodies, time, input, behaviours, live reload'],
  ['visuals', 'Visuals', 'How it looks: lights, materials, sky, animation, particles'],
  ['game', 'Game', 'Game systems: damage, weapons, pickups, screens, progression'],
  ['editor', 'Editor', 'The editing surface: panels, tools, gizmos, history'],
  ['agents', 'Agents', 'What an AI drives: packets, scene inspection, claims, the bridge']
]

/** Contribution points, in the order they matter to someone reading the list. */
const POINTS = [
  ['panels', 'panel'],
  ['tools', 'tool'],
  ['systems', 'system'],
  ['commands', 'command'],
  ['menus', 'menu'],
  ['fields', 'field'],
  ['importers', 'importer']
]

/**
 * The shown plugins, split into categories in reading order.
 *
 * Returns only the categories that have something in them, so an empty heading
 * is never printed. Anything declaring no category, or one nothing knows, is
 * gathered at the end rather than dropped.
 */
function grouped(plugins) {
  const out = CATEGORIES
    .map(([id, title, why]) => [id, title, why, plugins.filter(p => p.category === id)])
    .filter(([, , , items]) => items.length)
  const known = new Set(CATEGORIES.map(([id]) => id))
  const rest = plugins.filter(p => !known.has(p.category))
  if (rest.length) out.push(['uncategorised', 'Uncategorised', 'These declare no category', rest])
  return out
}

export default {
  name: 'Plugin Browser',

  category: 'editor',
  // The project's disabled list is applied by the kernel before any plugin
  // boots, not here. Doing it in an onLoad meant a disabled plugin had already
  // run its own onLoad — subscribed, taken its context key — before it was
  // marked off. This panel still turns one on and off during a session, which
  // is what `enable` is for.

  menus: [{
    id: 'plugins.browse',
    label: 'PLUGINS',
    title: 'What the engine is made of',
    on: () => state.open,
    run: context => { state.open = !state.open; context.redraw() }
  }],

  panels: [{
    id: 'plugins',
    title: 'Plugins · toggle',
    dock: 'centre',
    order: 20,
    when: () => state.open,

    actions: [{
      label: 'Close ×',
      title: 'Close the plugin browser',
      run: context => { state.open = false; context.redraw() }
    }],

    render(ui, context) {
      const all = [...context.loader.plugins.entries()].map(([name, p]) => ({
        name,
        enabled: p.enabled,
        error: p.error,
        builtin: p.builtin,
        about: p.definition.about || '',
        category: p.definition.category || '',
        needs: p.definition.needs || [],
        gives: POINTS
          .map(([point, word]) => {
            const n = (p.definition[point] || []).length
            return n ? `${n} ${word}${n > 1 ? 's' : ''}` : null
          })
          .filter(Boolean)
      }))

      const q = (context.state.q || '').toLowerCase()
      const shown = all.filter(p =>
        !q || p.name.toLowerCase().includes(q) || p.gives.join(' ').includes(q))

      const on = all.filter(p => p.enabled).length

      return ui.stack([
        ui.search({ bind: 'q', placeholder: 'name or what it contributes', count: shown.length }),

        ui.text(`Loaded · ${on} of ${all.length} on`, { dim: true }),

        // One section per category, and a section only when it has something to
        // show — a search that matches four plugins should not print five empty
        // headings.
        ...grouped(shown.filter(p => p.builtin)).map(([, title, why, items]) =>
          ui.section(`${title} · ${items.length}`, [
            ui.text(why, { dim: true }),
            ui.list({
              items,
              key: p => p.name,
              selected: state.selected,
              dim: p => !p.enabled,
              row: p => pluginRow(ui, context, p),
              onPick: p => select(context, p)
            })
          ])
        ),

        ui.section('This project', [
          ui.list({
            items: shown.filter(p => !p.builtin),
            key: p => p.name,
            selected: state.selected,
            dim: p => !p.enabled,
            row: p => pluginRow(ui, context, p),
            onPick: p => select(context, p),
            emptyText: `none yet — drop a .js file in ${context.editor.projectDirectory}/plugins/`
          })
        ]),

        ui.text(
          'A plugin is one file with an export default. Turn one off to see what it was holding up.',
          { dim: true }
        )
      ])
    }
  }],

  commands: [
    {
      id: 'plugins.list',
      label: 'List plugins',
      run: context => [...context.loader.plugins.entries()].map(([name, p]) => ({
        name,
        enabled: p.enabled,
        ...(p.error ? { error: p.error } : {}),
        category: p.definition.category || 'uncategorised',
        gives: Object.fromEntries(POINTS
          .map(([point]) => [point, (p.definition[point] || []).length])
          .filter(([, n]) => n))
      }))
    },
    {
      id: 'plugins.enable',
      label: 'Toggle a plugin',
      run: (context, args) => {
        const [name, on] = [].concat(args)
        const p = context.loader.plugins.get(name)
        if (!p) throw new Error(`no plugin "${name}". Try plugins.list`)
        setEnabled(context, name, on === undefined ? !p.enabled : !!on)
        return { name, enabled: context.loader.plugins.get(name).enabled }
      }
    }
  ]
}

function pluginRow(ui, context, p) {
  return [
    ui.toggle({
      value: p.enabled, label: '', stop: true,
      onChange: on => setEnabled(context, p.name, on).catch(() => {})
    }),
    ui.glyph(p.error ? '✗' : p.enabled ? '•' : '·', { strong: !!p.error }),
    ui.label(p.name),
    ui.spacer(),
    ui.meta(p.error || p.gives.join(', ') || 'contributes nothing')
  ]
}

function select(context, p) {
  state.selected = p.name
  context.bus.emit('plugin:selected', p)
  context.redraw()
}

/**
 * Turning a plugin off is a project decision, so it is written to game.json.
 *
 * A plugin cannot be un-loaded — its onLoad already ran and may hold DOM or
 * listeners — so disabling withdraws its contributions and the next reload
 * skips it entirely. Anything it added to `context` stays until then.
 */
async function setEnabled(context, name, on) {
  context.loader.enable(name, on)

  let game = {}
  try { game = JSON.parse(await context.files.read('game.json')) } catch { /* new file */ }

  const disabled = new Set(game.plugins?.disabled || [])
  on ? disabled.delete(name) : disabled.add(name)
  game.plugins = { ...game.plugins, disabled: [...disabled].sort() }

  await context.files.writeJSON('game.json', game)
  context.redraw()
}
