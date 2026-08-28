/**
 * New File — make a type, behaviour, level, test or plugin from the editor.
 *
 * Until now the only way to author anything was to write a file by hand, which
 * meant the editor could edit a project but never start one. Everything here
 * does exactly what a person would do at a terminal: write one file, in the
 * right folder, with a name.
 *
 * The templates matter more than the panel. A new type is the first thing
 * anyone reads to learn what a type *is*, so it shows the whole shape — the
 * four hooks, commented — and nothing else.
 */
const KINDS = [
  { id: 'type', label: 'type', dir: 'types', ext: '.js' },
  { id: 'behaviour', label: 'behaviour', dir: 'behaviours', ext: '.js' },
  { id: 'level', label: 'level', dir: 'levels', ext: '.json' },
  { id: 'test', label: 'test', dir: 'tests', ext: '.js' },
  { id: 'plugin', label: 'plugin', dir: 'plugins', ext: '.js' }
]

const state = { kind: 'type', name: '', error: null }

export default {
  name: 'New File',

  panels: [{
    id: 'new-file',
    title: 'New',
    dock: 'left',
    order: 15,
    scroll: false,
    when: context => context.editor._creating,

    actions: [{
      label: 'Cancel',
      run: context => { context.editor._creating = false; state.error = null }
    }],

    render(ui, context) {
      const kind = KINDS.find(k => k.id === state.kind)
      const path = `${kind.dir}/${slug(state.name) || '…'}${kind.ext}`

      return ui.stack([
        ui.pick({
          options: KINDS.map(k => ({ value: k.id, label: k.label })),
          value: state.kind,
          onChange: v => { state.kind = v; state.error = null }
        }),
        ui.field({
          k: 'name',
          v: state.name,
          onChange: v => { state.name = v; state.error = null }
        }),
        ui.text(path, { dim: true }),
        state.error ? ui.text(state.error, { dim: true }) : null,
        ui.row([
          ui.button('Create', () => {
            // The panel shows a refusal in place; the command throws. Same
            // function, and neither caller has to guess whether it worked.
            create(context).catch(e => { state.error = e.message; context.redraw() })
          }, { primary: true })
        ], { pad: true })
      ].filter(Boolean))
    }
  }],

  commands: [{
    id: 'new.file',
    label: 'Create a type, behaviour, level, test or plugin',
    // args: 'type' | ['type', 'enemy']
    run: (context, args) => {
      const [kind, name] = [].concat(args)
      if (name) { state.kind = kind; state.name = name; return create(context) }
      // No name given: open the form rather than guess one.
      state.kind = kind || 'type'
      context.editor._creating = true
      context.redraw()
      return { opened: 'the New panel', kind: state.kind }
    }
  }]
}

async function create(context) {
  const kind = KINDS.find(k => k.id === state.kind)
  const name = slug(state.name)
  if (!name) throw new Error('needs a name')

  const path = `${kind.dir}/${name}${kind.ext}`

  // Refuse rather than overwrite. Nothing else in this engine destroys a file,
  // and a "New" button that silently replaced one would be a nasty surprise.
  // Checked against disk, not the index, because a plugin has no index entry.
  const taken = await context.files.read(path).then(() => true, () => false)
  if (taken) throw new Error(`${path} already exists`)

  await context.files.write(path, TEMPLATES[kind.id](name))
  context.editor.index = await context.files.index()

  context.editor._creating = false
  state.name = ''
  state.error = null

  // Open it, because the next thing you want is to read what you just made.
  if (kind.ext === '.js') context.open(path)
  context.redraw()
  return { created: path }
}

/** File names are the identifier, so keep them to what an import can hold. */
const slug = s => String(s || '').trim().toLowerCase()
  .replace(/[^a-z0-9-_ ]/g, '')
  .replace(/[\s_]+/g, '-')
  .replace(/^-+|-+$/g, '')

// ------------------------------------------------------------------ templates
const TEMPLATES = {
  type: name => `export default {
  // How it draws. A bare name means assets/. Delete this to get a flat colour.
  // sprite: { image: '${name}.png', width: 1, height: 1 },

  // How big it hits. box: [w, h] or circle: r
  collider: { box: [1, 1] },

  // Defaults for every ${name}. A level can override any of them per placement,
  // and these are also what the inspector shows.
  properties: {},

  // Shared behaviours this type composes. Each one runs before the hooks below.
  // behaviours: ['float'],

  // The four hooks, and there are no others.
  // start(entity, context)                 {}  this ${name} entered the world
  // update(entity, seconds, context)       {}  one fixed step passed
  // onCollide(entity, other, context)      {}  began touching \`other\`
  // onDestroy(entity, context)             {}  left the world
}
`,

  behaviour: name => `export default {
  // One line, shown wherever this is offered for attaching.
  about: '${name.replace(/-/g, ' ')}',

  // Defaults. Everything here starts in \`self\`, and a type or a single
  // placement can change any of them.
  properties: {},

  // The same four hooks a type has, plus one extra argument: \`self\`, this
  // behaviour's own bag on the entity. Keep running state in there — never on
  // the entity directly — and nothing you attach can ever collide with
  // anything else attached to the same entity.
  //
  // start(entity, context, self)                 {}
  // update(entity, seconds, context, self)       {}
  // onCollide(entity, other, context, self)      {}
  // onDestroy(entity, context, self)             {}

  // A behaviour cannot look up another behaviour. If two need to agree, they
  // do it by reading and writing plain fields on \`entity\`.
}
`,

  level: () => JSON.stringify({
    camera: { mode: 'ortho', at: [0, 0], zoom: 48 },
    entities: []
  }, null, 2) + '\n',

  test: name => `export default {
  name: '${name.replace(/-/g, ' ')}',
  level: 'level1',

  run(test) {
    test.simulate(1)
    test.ok(true, 'say what should be true here')
  }
}
`,

  plugin: name => `export default {
  name: '${name}',

  // Contribution points: panels tools commands fields importers systems menus
  panels: [{
    id: '${name}',
    title: '${name}',
    dock: 'right',
    render: (ui, context) => ui.stack([
      ui.text(\`\${context.world.entities.length} entities in \${context.level()}\`)
    ])
  }]

  // onLoad(context) {}   runs once, before the shell exists
  // systems: [{ phase: 'fixed', run(world, seconds, context) {} }]
}
`
}
