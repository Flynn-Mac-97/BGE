/**
 * Project Switcher — which game this editor has open, and how to leave it.
 *
 * A project is a directory anywhere on disk. The dev server takes
 * `ENGINE_PROJECT` and a headless world takes `--project`; neither given opens
 * the untitled project, so the editor always has a game to work in.
 *
 * There is no save button and there is not going to be one. `engine/files.js`
 * writes straight through — the files on disk ARE the project. Unsaved means
 * unnamed, not held in memory, so `saveAs` renames the untitled directory
 * rather than writing a copy of anything.
 *
 * What each verb does:
 *
 *   list    the project directories beside the open one
 *   open    repoints the dev server, then reloads the page. The reload is what
 *           drops the old project: a plugin cannot be un-loaded once its onLoad
 *           has run, so without it the old project's panels and context verbs
 *           would stay live over the new project's world
 *   saveAs  renames the untitled directory to a name, then opens it
 *   close   opens a fresh untitled project, so closing leaves you somewhere
 *
 * The page reaches the project only through the `/project/` URL, so where it is
 * on disk is the server's answer and never the page's guess.
 */

/** What the server last said it serves, and whether we said it drifted. */
const state = { open: false, serving: null, directory: null, projects: null, reported: false }

/**
 * The projects this browser has opened.
 *
 * Browser-local, like the dock sizes: which games you happen to work on is not a
 * property of any one of them, so it never enters a project file. Most recent
 * first, and position IS the order — no timestamps, because nothing in this
 * engine reads a wall clock.
 */
const STORE = 'browser-game-engine.projects.v1'
const KEPT = 12

function remembered() {
  try {
    const list = JSON.parse(localStorage.getItem(STORE) || '[]')
    return Array.isArray(list) ? list.filter(name => typeof name === 'string') : []
  } catch { return [] }
}

function remember(name) {
  const list = [name, ...remembered().filter(other => other !== name)].slice(0, KEPT)
  try { localStorage.setItem(STORE, JSON.stringify(list)) } catch { /* storage may be blocked */ }
  return list
}

/** One path segment, and not a dot-directory: the shape a new project may be named. */
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

const ask = async (url, body) => {
  const response = await fetch(url, body
    ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
    : undefined)
  const answer = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(answer.error || `${url} answered ${response.status}`)
  return answer
}

/**
 * Ask the dev server which project it serves.
 *
 * Answering null is a real answer: a built page has no dev server, and then the
 * name the page was loaded with is the only one there is.
 */
async function askServer(context) {
  try {
    const body = await ask('/api/project')
    state.serving = typeof body.project === 'string' ? body.project : null
    state.directory = body.directory || null
    state.projects = body.projects || null
  } catch {
    state.serving = null
  }
  if (state.serving && state.serving !== context.editor.projectName && !state.reported) {
    state.reported = true
    console.error(`[project] this page was loaded for "${context.editor.projectName}" but the dev server` +
      ` now serves "${state.serving}" — run project.close to reload into it`)
  }
  context.redraw()
  return state.serving
}

const drifted = context => !!state.serving && state.serving !== context.editor.projectName

/** Every verb that repoints the server ends the same way, so it is written once. */
const reopen = answer => {
  if (answer.project) remember(answer.project)
  location.reload()
  return answer
}

/** A headless world is told its project as an argument, and has no server to ask. */
const headlessAnswer = (context, next) => ({
  project: context.editor.projectName,
  opened: false,
  why: 'a project is chosen when a world starts, and this world has already started',
  start: `node bin/engine.mjs --headless --project ${next} snapshot`
})

export default {
  name: 'Project Switcher',

  about: 'Says which project this editor has open, lists the ones beside it, opens another, ' +
    'gives the untitled project a name, and closes one by opening a fresh untitled project. ' +
    'The dev server repoints itself, so opening a project is a page reload and not a restart.',

  onLoad(context) {
    // shell:ready only fires where there is a document, which is exactly where
    // there is a server to ask.
    context.bus.on('shell:ready', () => { askServer(context) })
  },

  inspect: context => [{
    title: 'Project',
    rows: [
      ['name', context.editor.projectName],
      ['directory', state.directory ?? 'not asked'],
      ['projects', state.projects ?? 'not asked'],
      ['remembered', String(remembered().length)]
    ]
  }],

  menus: [{
    id: 'project.switch',
    label: 'PROJECT',
    title: 'Which project is open',
    on: () => state.open,
    run: context => context.run('project.panel')
  }],

  panels: [{
    id: 'project-switcher',
    title: 'Project · open, name, close',
    dock: 'centre',
    order: 10,
    when: () => state.open,

    actions: [{
      label: 'Close ×',
      title: 'Close this panel — not the project',
      run: context => { state.open = false; context.redraw() }
    }],

    render(ui, context) {
      const typed = String(context.state.name ?? '').trim()
      const open = context.editor.projectName
      const known = [open, ...remembered().filter(name => name !== open)]

      return ui.stack([
        ui.section('Open', [
          ui.field({ k: 'name', v: open }),
          ui.field({ k: 'directory', v: state.directory ?? '…' }),
          ui.field({ k: 'levels', v: context.levels().length }),
          ui.field({ k: 'types', v: context.types().length }),
          ui.field({ k: 'plugins', v: context.loader.plugins.size })
        ]),

        drifted(context)
          ? ui.section('The server moved', [
              ui.text(`The dev server now serves “${state.serving}” and this page was loaded for` +
                ` “${open}”. Until you reload, the index comes from one project and the` +
                ` textures come from the other.`),
              ui.button('Reload', () => location.reload(), { primary: true })
            ])
          : null,

        // Naming is offered only where it means something. A project that has a
        // name already is renamed by moving its directory, not by a button that
        // silently made a second copy.
        open === 'untitled'
          ? ui.section('Name this project', [
              ui.text('This project has no name yet. Naming it moves its directory into the ' +
                'projects folder — the files are the project, so there is nothing else to save.', { dim: true }),
              ui.row([
                ui.field({
                  k: 'name', v: typed, note: 'letters, digits, dash',
                  onChange: value => { context.state.name = value }
                }),
                ui.button('Save as', () => context.run('project.saveAs', typed), { primary: true })
              ])
            ])
          : null,

        ui.section(`Opened before · ${known.length}`, [
          ui.list({
            items: known,
            key: name => name,
            selected: open,
            row: name => [
              ui.glyph(name === open ? '•' : '·'),
              ui.label(name),
              ui.spacer(),
              ui.meta(name === open ? 'open' : '')
            ],
            onPick: name => context.run('project.open', name),
            emptyText: 'only this one so far'
          })
        ]),

        ui.section('Open another', [
          ui.field({
            k: 'directory', v: '', note: 'a name in the projects folder, or a path',
            onChange: value => { context.state.directory = value }
          }),
          ui.row([
            ui.button('Open', () => context.run('project.open', String(context.state.directory ?? '').trim())),
            ui.spacer(),
            ui.button('Close project', () => context.run('project.close'))
          ])
        ])
      ])
    }
  }],

  commands: [
    {
      id: 'project.panel',
      label: 'Show the project panel',
      run: context => {
        state.open = !state.open
        if (state.open) askServer(context)
        context.redraw()
        return { open: state.open }
      }
    },

    {
      id: 'project.list',
      label: 'Which projects there are',
      async run(context) {
        if (!context.shell) {
          return {
            screen: false,
            open: context.editor.projectName,
            levels: context.levels().length,
            note: 'a headless world is told its project as an argument — node bin/engine.mjs --headless --project PATH'
          }
        }
        const body = await ask('/api/project/list')
        return {
          open: context.editor.projectName,
          directory: state.directory,
          projects: body.projects,
          names: body.names,
          recent: remembered()
        }
      }
    },

    {
      id: 'project.open',
      label: 'Open a project by name or path',
      async run(context, said) {
        const wanted = String([].concat(said ?? [])[0] ?? '').trim()
        if (!wanted) throw new Error('which project? project.open "demo" — a name in the projects folder, or a path')
        if (!context.shell) return headlessAnswer(context, wanted)
        // A bare name is a project beside the open one; anything else is a path
        // the server resolves against the checkout.
        const asked = NAME.test(wanted) ? `${state.projects || ''}/${wanted}` : wanted
        return reopen(await ask('/api/project/open', { path: asked }))
      }
    },

    {
      id: 'project.saveAs',
      label: 'Give the untitled project a name',
      async run(context, said) {
        const name = String([].concat(said ?? [])[0] ?? '').trim()
        if (!NAME.test(name)) {
          throw new Error(`"${name}" is not a project name — letters, digits, dot, dash or underscore, one segment, no leading dot`)
        }
        if (!context.shell) return headlessAnswer(context, name)
        if (context.editor.projectName !== 'untitled') {
          throw new Error(`"${context.editor.projectName}" already has a name — move its directory to rename it`)
        }
        return reopen(await ask('/api/project/save-as', { name }))
      }
    },

    {
      id: 'project.close',
      label: 'Close the project — opens a fresh untitled one',
      async run(context) {
        if (!context.shell) {
          return { screen: false, note: 'a headless world ends with its process — there is nothing to close' }
        }
        return reopen(await ask('/api/project/close', {}))
      }
    }
  ]
}
