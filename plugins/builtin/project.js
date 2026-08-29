/**
 * Project Switcher — which game this editor has open, and how to leave it.
 *
 * The project directory is a parameter now: the dev server takes `ENGINE_PROJECT`
 * and a headless world takes `--project`. Once it is a parameter, the editor has
 * to be able to say which one it is looking at, because two projects on one
 * checkout look identical from inside the page.
 *
 * There is no save button here and there is not going to be one. `engine/files.js`
 * writes straight through — the file on disk IS the project, and a save-only copy
 * of it is the one thing this codebase has never had. So the verbs are open and
 * close, and nothing else.
 *
 * What each verb honestly does:
 *
 *   close  reloads the page. That is the whole meaning of closing. A plugin
 *          cannot be un-loaded mid-session — its onLoad has already run and it
 *          holds DOM and listeners — and Counter-Strike ships eight project
 *          plugins, so dropping a project without a reload would leave the old
 *          project's panels and context verbs live over the new project's world.
 *   open   reloads the page when the dev server already serves that project.
 *          When it does not, the page cannot repoint a running server, so it
 *          remembers the name and hands back the one command that starts one.
 *
 * It also watches for the case that has no symptom: the server restarted onto a
 * different project while this tab stayed open. The page then reads one
 * project's index and fetches another project's textures. It asks the server
 * which project it serves and reports the disagreement by name.
 */
import { PROJECT_DIRECTORY } from '../../engine/asset-path.js'

/** Panel open, what the server last said it serves, and whether we said it drifted. */
const state = { open: false, serving: null, reported: false }

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

/** One path segment, so a name can only ever be a directory beside this one. */
const NAME = /^[A-Za-z0-9._-]+$/

/**
 * Ask the dev server which project it serves.
 *
 * Answering null is a real answer: a built page has no dev server, and so the
 * name the page was built with is the only one there is.
 */
async function askServer(context) {
  try {
    const body = await (await fetch('/api/project')).json()
    state.serving = typeof body.project === 'string' ? body.project : null
  } catch {
    state.serving = null
  }
  if (state.serving && state.serving !== PROJECT_DIRECTORY && !state.reported) {
    state.reported = true
    console.error(`[project] this page was loaded for "${PROJECT_DIRECTORY}" but the dev server now serves` +
      ` "${state.serving}" — run project.close to reload into it`)
  }
  context.redraw()
  return state.serving
}

const drifted = () => !!state.serving && state.serving !== PROJECT_DIRECTORY

export default {
  name: 'Project Switcher',

  about: 'Says which project directory this editor has open, remembers the ones you have opened, ' +
    'and closes one by reloading the page. Opening a different project starts a new world, so the ' +
    'page hands back the command rather than pretending it can repoint a running dev server.',

  onLoad(context) {
    // shell:ready only fires where there is a document, which is exactly where
    // there is a server to ask.
    context.bus.on('shell:ready', () => { askServer(context) })
  },

  inspect: context => [{
    title: 'Project',
    rows: [
      ['page', PROJECT_DIRECTORY],
      ['server', state.serving ?? 'not asked'],
      ['title', context.editor.projectName],
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
    title: 'Project · open and close',
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
      const known = [PROJECT_DIRECTORY, ...remembered().filter(name => name !== PROJECT_DIRECTORY)]

      return ui.stack([
        ui.section('Open', [
          ui.field({ k: 'directory', v: PROJECT_DIRECTORY }),
          ui.field({ k: 'title', v: context.editor.projectName }),
          ui.field({ k: 'levels', v: context.levels().length }),
          ui.field({ k: 'types', v: context.types().length }),
          ui.field({ k: 'plugins', v: context.loader.plugins.size })
        ]),

        drifted()
          ? ui.section('The server moved', [
              ui.text(`The dev server now serves “${state.serving}” and this page was loaded for` +
                ` “${PROJECT_DIRECTORY}”. Until you reload, the index comes from one project and the` +
                ` textures come from the other.`),
              ui.button('Close and reload', () => context.run('project.close'), { primary: true })
            ])
          : null,

        ui.section(`Opened before · ${known.length}`, [
          ui.list({
            items: known,
            key: name => name,
            selected: PROJECT_DIRECTORY,
            row: name => [
              ui.glyph(name === PROJECT_DIRECTORY ? '•' : '·'),
              ui.label(name),
              ui.spacer(),
              ui.meta(name === PROJECT_DIRECTORY ? 'open' : name === state.serving ? 'served' : '')
            ],
            onPick: name => context.run('project.open', name),
            emptyText: 'only this one so far'
          })
        ]),

        ui.section('Open another', [
          ui.field({
            k: 'directory', v: typed, note: 'a directory beside this one',
            onChange: value => { context.state.name = value }
          }),
          ui.row([
            ui.button('Open', () => context.run('project.open', String(context.state.name ?? '').trim())),
            ui.spacer(),
            ui.button('Close project', () => context.run('project.close'))
          ])
        ]),

        ui.text('Closing is a page reload — a plugin cannot be un-loaded once its onLoad has run, ' +
          'so the only way to drop a project is to load the page again. Opening a different project ' +
          'restarts the dev server: ENGINE_PROJECT=name npm run dev.', { dim: true })
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
      label: 'Which project is open',
      run: context => {
        // A headless world is handed its project directory as an argument and
        // nothing carries that into `context`, so this must not guess: reporting
        // the default directory for a world opened on another one is a lie.
        if (!context.shell) {
          return {
            screen: false,
            title: context.editor.projectName,
            levels: context.levels().length,
            note: 'a headless world is told its project as an argument — node bin/engine.mjs --headless --project NAME'
          }
        }
        return {
          page: PROJECT_DIRECTORY,
          serving: state.serving,
          stale: drifted(),
          title: context.editor.projectName,
          recent: remembered()
        }
      }
    },

    {
      id: 'project.open',
      label: 'Open a project by directory name',
      async run(context, name) {
        const wanted = String([].concat(name ?? [])[0] ?? '').trim()
        if (!wanted) throw new Error('which project? project.open "demo" — a directory name inside the checkout')
        if (!NAME.test(wanted)) {
          throw new Error(`"${wanted}" is not a directory name inside the checkout — one segment, no slashes`)
        }

        if (!context.shell) {
          return {
            project: wanted,
            opened: false,
            why: 'a project is chosen when a world starts, and this world has already started',
            start: `node bin/engine.mjs --headless --project ${wanted} snapshot`
          }
        }

        remember(wanted)
        // Ask rather than assume: the server may already have been restarted
        // onto this project, and then opening it really is just a reload.
        const serving = await askServer(context)
        if (serving === wanted) {
          location.reload()
          return { project: wanted, opened: true }
        }

        return {
          project: wanted,
          opened: false,
          serving,
          why: 'a page cannot repoint the dev server that serves it, and the project is read once at start-up',
          start: `ENGINE_PROJECT=${wanted} npm run dev`,
          then: 'project.close — the reload is what drops this project'
        }
      }
    },

    {
      id: 'project.close',
      label: 'Close the project — reloads the page',
      run: context => {
        if (!context.shell) {
          return { screen: false, note: 'a headless world ends with its process — there is nothing to close' }
        }
        const opening = state.serving || PROJECT_DIRECTORY
        location.reload()
        return { closed: PROJECT_DIRECTORY, opening }
      }
    }
  ]
}
