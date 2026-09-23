import { listDocuments, readDocument, writeDocument } from './document-store.mjs'
import { readSource, sourceCatalog, writeSource } from './source-files.mjs'
import fs from 'node:fs/promises'
import path from 'node:path'
// The index builder and the determinism lint live in the engine, not in this
// config, so a world running headless in node builds the same index from the
// same code. Two implementations of "what is in this project" would drift.
import { buildIndex as buildProjectIndex, walk, KIND } from './project-index.mjs'
import { problemsIn, fatal } from './project-problems.mjs'
import { recordServer, forgetServer } from './project-servers.mjs'
import { writeGeneratedAgentFiles } from './agent-registration.mjs'
import {
  chooseClient,
  describeClient,
  explainClientError,
  isLive,
  mergeClient,
  ownNonce,
  publicClient
} from './bridge-clients.mjs'
import { readLaneBrowsers } from './lane-browsers.mjs'
import { workLock, permits, roleOfClient } from './work-lock.mjs'
import { PROJECT_PREFIX } from './asset-path.js'
import { pluginGuides } from './plugin-guides.mjs'
import { pluginInterfaceReader } from './plugin-interface.mjs'
import { openPage } from './open-page.mjs'
import {
  ensureProject,
  isUntitled,
  projectName,
  projectsRoot,
  resolveProject,
  untitledProject,
  UNTITLED
} from './project-path.mjs'

// eslint-disable-next-line max-lines-per-function -- one Vite config factory; its plugin factories share the mutable PROJECT and client maps, so splitting it needs a shared-state record. A redesign.
export function engineServerConfig({
  root = process.cwd(),
  project = process.env.ENGINE_PROJECT,
  desktop = false,
  desktopSnapshot,
  desktopCapture
} = {}) {
  const ROOT = root

  let PROJECT = resolveProject(ROOT, project)

  let PROJECT_NAME = projectName(PROJECT)
  const readProjectName = async () => {
    const game = JSON.parse(await fs.readFile(path.join(PROJECT, 'game.json'), 'utf8').catch(() => '{}'))
    PROJECT_NAME = projectName(PROJECT, game.title)
    return PROJECT_NAME
  }

  function watchProject(server) {
    const outside = !PROJECT.startsWith(ROOT + path.sep)
    if ((desktop || outside) && path.basename(PROJECT) !== UNTITLED) server.watcher.add(PROJECT)
  }

  function stopWatchingProject(server) {
    if (desktop || !PROJECT.startsWith(ROOT + path.sep)) server.watcher.unwatch(PROJECT)
  }

  async function openProject(server, next) {
    const wanted = path.resolve(ROOT, next)
    stopWatchingProject(server)
    PROJECT = wanted
    await readProjectName()
    const allow = server.config.server.fs.allow
    if (!allow.includes(wanted)) allow.push(wanted)
    watchProject(server)
    return { project: PROJECT_NAME, directory: PROJECT }
  }

  const lastWritten = new Map()

  const slash = p => p.split(path.sep).join('/')
  // Read per call, not once: the served project changes when one is opened.
  const projectURL = () => slash(PROJECT)
  const PROJECT_ROOT_URL = slash(ROOT)
  const inProject = p => slash(p).startsWith(projectURL() + '/')

  const relative = p => slash(p).slice(projectURL().length + 1)

  const watched = file => {
    const full = slash(path.resolve(file))
    // Relative to whichever root the file is under. The project may be outside
    // the checkout, and slicing by the wrong root leaves an absolute path whose
    // own directories are then read as dot-directories.
    const base = full.startsWith(projectURL() + '/') ? projectURL() : PROJECT_ROOT_URL
    return !/(^|\/)\.[^/]/.test(full.slice(base.length))
  }

  async function renameWhenFree(from, to, attempts = 20) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await fs.rename(from, to)
      } catch (error) {
        const busy = ['EPERM', 'EBUSY', 'EACCES', 'ENOTEMPTY'].includes(error.code)
        if (!busy || attempt >= attempts) throw error
        await new Promise(resolve => setTimeout(resolve, 25))
      }
    }
  }

  const send = (res, code, body) => {
    res.statusCode = code
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify(body))
  }

  const readBody = req =>
    new Promise(resolve => {
      let s = ''
      req.on('data', c => (s += c))
      req.on('end', () => resolve(s ? JSON.parse(s) : {}))
    })

  function safe(rel) {
    const abs = path.resolve(PROJECT, rel)
    if (abs !== PROJECT && !abs.startsWith(PROJECT + path.sep)) return null
    return abs
  }

  function safeAgent(scope, rel) {
    let base = null
    if (scope === 'engine') base = ROOT
    else if (scope === 'project') base = PROJECT
    const clean = slash(String(rel || '')).replace(/^\.\//, '')
    const allowed =
      scope === 'engine'
        ? clean === 'AGENTS.md' ||
          clean === 'ENGINE-BASE.md' ||
          clean === 'ARCHITECTURE.md' ||
          clean.startsWith('agents/') ||
          clean.startsWith('docs/') ||
          /^plugins\/builtin\/[^/]+\.agent(?:\.md|\/[^/]+\.md)$/.test(clean)
        : clean.startsWith('agents/') || /^plugins\/[^/]+\.agent(?:\.md|\/[^/]+\.md)$/.test(clean)
    if (!base || !allowed) return null
    const abs = path.resolve(base, clean)
    return abs.startsWith(base + path.sep) ? abs : null
  }

  const FILE_ROUTE_OP = 'code.save'

  const refusedFileWrite = request => {
    const lock = workLock(ROOT)
    const role = roleOfClient(ROOT, String(request.headers['x-engine-client'] || ''))
    const { allowed, why } = permits(lock, FILE_ROUTE_OP, role)
    return allowed ? null : { ok: false, code: 'held', error: why, lock, serves: ROOT }
  }

  const buildIndex = () => buildProjectIndex(PROJECT, ROOT)
  let interfaceReader
  let interfaceProject
  async function agentInterface(scope, file) {
    if (!interfaceReader || interfaceProject !== PROJECT) {
      interfaceProject = PROJECT
      interfaceReader = pluginInterfaceReader({ root: ROOT, projectDirectory: PROJECT })
    }
    const reader = await interfaceReader
    // Without Plugin Master there is no parser and no interface to answer with.
    return reader ? reader(scope, file) : null
  }

  function serveProject() {
    const mount = `/${PROJECT_PREFIX}/`
    return {
      name: 'engine-project-mount',
      configureServer(server) {
        // Created if it is not there. Opening the editor with nothing on disk is
        // the blank-project case, and it has to leave a project behind.
        ensureProject(PROJECT)
          .then(readProjectName)
          .then(() => buildIndex())
          .catch(error => {
            console.error(`[engine] cannot open ${PROJECT}: ${error.message}`)
          })
        // Vite watches its own root. A project outside it is watched only if the
        // watcher is told, and without that no project edit reaches the editor.
        watchProject(server)
        server.middlewares.use((req, res, next) => {
          if (!req.url?.startsWith(mount)) {
            next()
            return
          }
          const rest = req.url.slice(mount.length)
          req.url = '/@fs' + slash(path.join(PROJECT, rest)).replace(/^(?![/])/, '/')
          next()
        })
      }
    }
  }

  const API_ROUTES = {
    '/api/client-role': async ({ url }) => ({
      status: 200,
      body: { role: roleOfClient(ROOT, url.searchParams.get('client')) }
    }),
    '/api/desktop': async () => ({
      status: 200,
      body: desktopSnapshot ? desktopSnapshot() : { supported: false, instances: [] }
    }),
    '/api/desktop/capture': async ({ url }) => {
      if (!desktopCapture) return { status: 404, body: { error: 'Editor capture requires the desktop engine' } }
      return { status: 200, body: await desktopCapture(Object.fromEntries(url.searchParams)) }
    },
    '/api/index': async () => ({ status: 200, body: await buildIndex() }),

    // Answers "is what I just wrote valid?" without a reload: broken imports,
    // unreadable levels, and anything that breaks determinism.
    '/api/check': async () => {
      const problems = problemsIn(await buildIndex())
      // `ok` follows the fatal ones. A warning is worth reading and never worth
      // failing on, and both callers of `problemsIn` agree on that through the
      // same function.
      return { status: 200, body: { ok: fatal(problems).length === 0, problems } }
    },

    '/api/tree': async () => {
      const files = await walk(PROJECT)
      return {
        status: 200,
        body: files.filter(f => !f.startsWith('.engine')).map(f => ({ path: f, kind: KIND(f) }))
      }
    },

    '/api/agent-plugins': async () => ({ status: 200, body: await pluginGuides(ROOT, PROJECT) }),

    '/api/agent-interface': async ({ url }) => ({
      status: 200,
      body: { text: await agentInterface(url.searchParams.get('scope'), url.searchParams.get('path')) }
    }),

    // Which project this server serves. A page is built with that name baked in,
    // so a server restarted onto a different project leaves a live tab reading one
    // project's index and fetching another project's textures — and nothing on
    // screen says so. This is how the tab asks.
    '/api/project': async () => ({
      status: 200,
      body: {
        project: PROJECT_NAME,
        directory: PROJECT,
        projects: projectsRoot(ROOT),
        // The page holds edits instead of writing them while this is true.
        untitled: isUntitled(PROJECT)
      }
    }),

    // Every project directory beside the open one. The untitled project is
    // skipped: it is a working directory, not a project you pick.
    '/api/project/list': async () => {
      const home = projectsRoot(ROOT)
      const entries = await fs.readdir(home, { withFileTypes: true }).catch(() => [])
      return {
        status: 200,
        body: {
          projects: home,
          names: entries
            .filter(e => e.isDirectory() && !e.name.startsWith('.'))
            .map(e => e.name)
            .sort()
        }
      }
    },

    // Repoint this server. A page cannot restart the server that serves it, so the
    // server does it and the page reloads.
    '/api/project/open': async ({ server, req }) => {
      if (req.method !== 'POST') return null
      const refused = refusedFileWrite(req)
      if (refused) return { status: 423, body: refused }
      const said = String((await readBody(req)).path || '').trim()
      if (!said) return { status: 400, body: { error: 'which project? a directory path' } }
      const wanted = path.resolve(ROOT, said)
      const there = await fs.stat(wanted).then(
        s => s.isDirectory(),
        () => false
      )
      if (!there) return { status: 404, body: { error: `no project directory at ${wanted}` } }
      const opened = await openProject(server, wanted)
      await buildIndex()
      return { status: 200, body: { ...opened, opened: true } }
    },

    // Leave the open project for a blank one. Closing has to leave you somewhere,
    // so the untitled project is created if it is not there.
    '/api/project/close': async ({ server, req }) => {
      if (req.method !== 'POST') return null
      const refused = refusedFileWrite(req)
      if (refused) return { status: 423, body: refused }
      const blank = await ensureProject(untitledProject(ROOT))
      const opened = await openProject(server, blank)
      await buildIndex()
      return { status: 200, body: { ...opened, closed: true } }
    },

    // Give the untitled project a name. A rename, not a copy: the files are
    // already the project, so naming it is moving the directory.
    '/api/project/save-as': async ({ server, req }) => {
      if (req.method !== 'POST') return null
      const refused = refusedFileWrite(req)
      if (refused) return { status: 423, body: refused }
      const name = String((await readBody(req)).name || '').trim()
      if (!/^[A-Za-z0-9._-]+$/.test(name) || name.startsWith('.')) {
        return {
          status: 400,
          body: {
            error: `"${name}" is not a project name — letters, digits, dot, dash or underscore, one segment, no leading dot`
          }
        }
      }
      const target = path.join(projectsRoot(ROOT), name)
      if (
        await fs.stat(target).then(
          () => true,
          () => false
        )
      ) {
        return { status: 409, body: { error: `${target} already exists — pick another name` } }
      }
      await fs.mkdir(path.dirname(target), { recursive: true })
      await renameWhenFree(PROJECT, target)
      // The title is the project's own, so it travels with the files. It is
      // written before the server reads the name back.
      const game = JSON.parse(await fs.readFile(path.join(target, 'game.json'), 'utf8').catch(() => '{}'))
      await fs.writeFile(
        path.join(target, 'game.json'),
        JSON.stringify({ ...game, title: name }, null, 2) + '\n',
        'utf8'
      )
      const opened = await openProject(server, target)
      await buildIndex()
      return { status: 200, body: { ...opened, saved: true } }
    },

    '/api/systems/catalog': async ({ url, req }) =>
      req.method === 'GET'
        ? { status: 200, body: await sourceCatalog(ROOT, PROJECT, url.searchParams.get('selection') || 'core') }
        : null,

    '/api/systems/documents': async ({ req }) =>
      req.method === 'GET' ? { status: 200, body: await listDocuments(PROJECT) } : null,

    '/api/systems/document': async ({ url, req }) => {
      if (req.method === 'GET') {
        const id = url.searchParams.get('id')
        const backup = url.searchParams.get('backup') === 'true'
        return { status: 200, body: await readDocument(PROJECT, id, backup) }
      }
      if (req.method !== 'POST') return null
      const refused = refusedFileWrite(req)
      if (refused) return { status: 423, body: refused }
      const body = await readBody(req)
      return { status: 200, body: await writeDocument(PROJECT, body.id, body.data, body.revision) }
    },

    '/api/systems/source': async ({ url, req }) => {
      if (req.method === 'POST') {
        const refused = refusedFileWrite(req)
        if (refused) return { status: 423, body: refused }
        const body = await readBody(req)
        return {
          status: 200,
          body: await writeSource(ROOT, PROJECT, body.scope, body.file, body.text, body.expectedHash)
        }
      }
      if (req.method !== 'GET') return null
      const scope = url.searchParams.get('scope')
      const file = url.searchParams.get('path')
      return { status: 200, body: await readSource(ROOT, PROJECT, scope, file) }
    },

    '/api/file': async ({ url, req }) => {
      if (req.method === 'GET') {
        const abs = safe(url.searchParams.get('path') || '')
        if (!abs) return { status: 400, body: { error: 'path outside project' } }
        return { status: 200, body: { text: await fs.readFile(abs, 'utf8') } }
      }
      if (req.method !== 'POST') return null
      const refused = refusedFileWrite(req)
      if (refused) return { status: 423, body: refused }
      const { path: rel, text } = await readBody(req)
      const abs = safe(rel || '')
      if (!abs) return { status: 400, body: { error: 'path outside project' } }
      await fs.mkdir(path.dirname(abs), { recursive: true })
      lastWritten.set(rel, text)
      await fs.writeFile(abs, text, 'utf8')
      await buildIndex()
      return { status: 200, body: { ok: true } }
    },

    '/api/agent-file': async ({ url, req }) => {
      if (req.method === 'GET') {
        const abs = safeAgent(url.searchParams.get('scope'), url.searchParams.get('path'))
        if (!abs) return { status: 400, body: { error: 'bad agent file path' } }
        return { status: 200, body: { text: await fs.readFile(abs, 'utf8') } }
      }
      if (req.method !== 'POST') return null
      const refused = refusedFileWrite(req)
      if (refused) return { status: 423, body: refused }
      const { scope, path: rel, text } = await readBody(req)
      const abs = safeAgent(scope, rel)
      if (!abs) return { status: 400, body: { error: 'bad agent file path' } }
      await fs.mkdir(path.dirname(abs), { recursive: true })
      await fs.writeFile(abs, text, 'utf8')
      if (scope === 'project') await buildIndex()
      if (scope === 'engine' && rel === 'agents/bootstrap.md') await writeAgentDoc()
      return { status: 200, body: { ok: true } }
    }
  }

  function api() {
    return {
      name: 'engine-api',
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          const url = new URL(req.url, 'http://x')
          if (!url.pathname.startsWith('/api/')) return next()

          try {
            const route = API_ROUTES[url.pathname]
            const answer = route ? await route({ server, url, req }) : null
            if (!answer) return send(res, 404, { error: 'no such endpoint' })
            return send(res, answer.status, answer.body)
          } catch (e) {
            return send(res, 500, { error: String(e.message || e) })
          }
        })
      }
    }
  }

  const clients = new Map()

  const liveClients = () => [...clients.values()].filter(isLive)

  function bridge() {
    const waiting = new Map()
    let seq = 0

    return {
      name: 'engine-bridge',

      handleHotUpdate({ file, server }) {
        if (!inProject(file)) return undefined

        // Returning [] alone stops the reload *and* the invalidation, so the
        // re-import would be served the cached transform and the edit would
        // appear to do nothing. Drop the cached module first, then decline the
        // reload.
        for (const m of server.moduleGraph.getModulesByFile(file) || []) {
          server.moduleGraph.invalidateModule(m)
        }
        return []
      },

      configureServer(server) {
        // Which project this server is serving, said once at start. Silence here
        // means an editor pointed at the wrong game looks exactly like an editor
        // pointed at the right one.
        console.log(`[engine] serving project: ${PROJECT_NAME} (${PROJECT})`)

        server.watcher.on('error', error => {
          console.warn(`[engine] file watcher: ${error?.message || error}`)
        })

        server.watcher.on('all', async (event, abs) => {
          const engineFile = path.relative(ROOT, abs).replaceAll('\\', '/')
          const projectFile = path.relative(PROJECT, abs).replaceAll('\\', '/')
          let scope = null
          if (/^plugins\/builtin\/[^/]+\.js$/.test(engineFile)) scope = 'engine'
          else if (/^plugins\/[^/]+\.js$/.test(projectFile)) scope = 'project'
          if (scope && event !== 'unlink') {
            try {
              await agentInterface(scope, scope === 'engine' ? engineFile : projectFile)
            } catch (error) {
              console.warn(`[engine] could not update plugin interface: ${error.message}`)
            }
          }
          if (abs.includes('interface.generated.md')) return
          if (!inProject(abs)) {
            if (slash(abs) === slash(path.join(ROOT, 'agents/bootstrap.md')) && event !== 'unlink')
              await writeAgentDoc()
            return
          }
          const rel = relative(abs)
          if (rel.startsWith('.engine/') || path.basename(rel).startsWith('.')) return

          // The root guide is a generated compatibility file. Its small source
          // lives with the other agent lanes and should update just as promptly.
          // Our own save coming back at us.
          if (lastWritten.has(rel)) {
            if (event === 'change') {
              const now = await fs.readFile(abs, 'utf8').catch(() => null)
              if (now === lastWritten.get(rel)) return
            }
            lastWritten.delete(rel)
          }

          // A failed rebuild must not take the server with it. This handler is
          // async, so anything it throws is an unhandled rejection and node ends
          // the process — the editor vanishes mid-edit and the last thing on
          // screen is a stack trace about a temporary file. Say what happened and
          // keep serving; the next save rebuilds anyway.
          try {
            await buildIndex()
          } catch (error) {
            console.warn(`[engine] could not rebuild the index: ${error?.message || error}`)
          }
          server.ws.send('engine:changed', {
            event, // add | change | unlink
            file: rel,
            kind: KIND(rel),
            name: path.basename(rel).replace(/\.[^.]+$/, '')
          })
        })

        server.ws.on('engine:reply', (message, client) => {
          const resolve = waiting.get(message.id)
          // A call goes to one client now, so a reply with no pending id is from
          // a client that answered after the caller gave up.
          if (!resolve) return
          waiting.delete(message.id)
          const answered = [...clients.values()].find(entry => entry.client === client)
          resolve({ ...message, answeredBy: answered ? publicClient(answered) : null })
        })

        server.middlewares.use(async (req, res, next) => {
          if (req.url.split('?')[0] !== '/api/engine' || req.method !== 'POST') return next()

          const { op, args = [], timeout = 8000, client: wanted } = await readBody(req)
          if (!op) return send(res, 400, { error: 'missing op' })

          // This server's own port. A fixed one sends a lane driving its own
          // server to somebody else's tab.
          const where = `http://localhost:${server.config.server.port}`
          const { chosen, error, live = [] } = chooseClient([...clients.values()], wanted)
          if (error) {
            return send(res, error === 'no-client' ? 502 : 409, {
              ok: false,
              code: error,
              error: explainClientError(error, { wanted, live, where }),
              clients: live.map(publicClient),
              serves: ROOT
            })
          }

          // A lane's render page may drive its own world and may never write a
          // file; the person's editor may not write while a lane is working. The
          // file routes hold the same rule, because a write reaches disk through
          // them as well. The role comes from the lane registry, so a page cannot
          // claim its way out of it.
          const lock = workLock(ROOT)
          const { allowed, why: held } = permits(lock, op, roleOfClient(ROOT, chosen.id))
          if (!allowed) {
            return send(res, 423, {
              ok: false,
              code: 'held',
              error: held,
              lock,
              serves: ROOT
            })
          }

          const id = ++seq
          const pending = new Promise(resolve => {
            waiting.set(id, resolve)
            setTimeout(() => {
              if (waiting.delete(id)) {
                resolve({
                  ok: false,
                  code: 'no-reply',
                  error: explainClientError('no-reply', { chosen, timeout })
                })
              }
            }, timeout)
          })
          chosen.client.send('engine:call', { id, op, args })

          const reply = await pending
          // Which checkout this server serves, on every reply. A CLI run from a
          // lane worktree compares it against its own root and refuses a
          // mismatch — the only proof there is that a `spawn` is not about to
          // land in somebody else's workspace through a shared port.
          return send(res, reply.ok ? 200 : 502, { ...reply, serves: ROOT })
        })
      }
    }
  }

  const TAB_BEACON = 'virtual:engine-tab-beacon'
  const TAB_BEACON_MODULE = '\0' + TAB_BEACON
  const TAB_BEACON_URL = '/@id/__x00__' + TAB_BEACON

  const TAB_BEACON_SOURCE = `
  import { engineTransport } from '/engine/transport.js'
  const hot = engineTransport(import.meta.hot)
  if (hot) {
    const key = 'engine:tab-id'
    // A page opened as ?client=<name> keeps that name, so a lane can target its
    // own headless page by a name it chose instead of a value it must first go
    // and read. Anything else keeps a random name for the length of the session.
    const asked = new URLSearchParams(location.search).get('client')
    let id = asked || sessionStorage.getItem(key)
    if (!id) { id = Math.random().toString(36).slice(2, 10) }
    sessionStorage.setItem(key, id)
    // The nonce says which page this is across its own reloads. One definition,
    // inlined from engine/bridge-clients.mjs, so a node test proves the rule this
    // page runs.
    const ownNonce = ${ownNonce}
    const nonce = ownNonce(sessionStorage, {
      hasOpener: Boolean(window.opener),
      mint: () => Math.random().toString(36).slice(2, 10)
    })
    // A page opened under a name is one a lane renders in. Its world is its own;
    // the checkout is shared, so it never writes a file. The name is kept, not a
    // flag, so a refused write says which lane asked. Set before the editor
    // boots, because the first thing a level load can do is save.
    if (asked) {
      globalThis.__engineViewer = id
      globalThis.__engineRoleReady = fetch('/api/client-role?client=' + encodeURIComponent(id))
        .then(response => response.json())
        .then(reply => { if (reply.role === 'person') delete globalThis.__engineViewer })
    }
    const announce = () => hot.send('engine:tab', {
      id,
      nonce,
      url: location.href,
      title: document.title,
      hidden: document.hidden,
      // The size a capture comes out at, and whether anybody can see this page.
      // Both decide whether a client is the right one to answer, and the server
      // can read neither from a websocket.
      viewport: innerWidth + 'x' + innerHeight,
      pixelRatio: devicePixelRatio,
      // navigator.webdriver alone is false for a browser started with
      // --headless=new and no automation flag, so the user agent is read too.
      headless: navigator.webdriver === true || /headless/i.test(navigator.userAgent)
    })
    // The editor names the tab; this only marks it offline. Setting a title here
    // as well would race the editor's own, which boots after this script.
    const OFFLINE = 'OFFLINE · '
    const WHAT = ${JSON.stringify(PROJECT_NAME)} + ' :' + location.port

    const DEAD_ID = 'engine-server-gone'
    const showDead = () => {
      if (document.getElementById(DEAD_ID)) return
      if (!document.title.startsWith(OFFLINE)) document.title = OFFLINE + document.title
      const banner = document.createElement('div')
      banner.id = DEAD_ID
      banner.textContent = 'This tab\\u2019s engine has stopped — ' + WHAT +
        '. Nothing here is live. Close it, or start that server again.'
      banner.style.cssText = [
        'position:fixed', 'inset:0', 'z-index:2147483647',
        'display:flex', 'align-items:center', 'justify-content:center',
        'padding:2rem', 'text-align:center',
        'background:rgba(24,10,10,0.92)', 'color:#ffb4a8',
        'font:600 15px/1.6 ui-monospace,monospace', 'cursor:default'
      ].join(';')
      document.body.appendChild(banner)
    }
    const clearDead = () => {
      document.getElementById(DEAD_ID)?.remove()
      document.title = document.title.replace(OFFLINE, '')
    }
    hot.on('vite:ws:disconnect', showDead)
    hot.on('vite:ws:connect', clearDead)

    announce()
    addEventListener('visibilitychange', announce)
    addEventListener('resize', announce)
    // A name stays with the page that holds it until that page's socket closes,
    // so a reload that announces before the socket it replaces has gone is
    // refused. Announcing again takes the name back as soon as that socket goes.
    setInterval(announce, 3000)
  }
  `

  const SEE_DIRECTORY = path.join(ROOT, 'agent-runs/see')

  async function newestLaneFrame(client) {
    if (!client || /[\\/]/.test(client)) return null
    let names
    try {
      names = await fs.readdir(SEE_DIRECTORY)
    } catch {
      return null
    }
    let newest = null
    for (const name of names.filter(entryName => entryName.endsWith('.png') && entryName.includes(client))) {
      const when = await fs.stat(path.join(SEE_DIRECTORY, name)).then(
        stat => stat.mtimeMs,
        () => null
      )
      if (when !== null && (!newest || when > newest.when)) newest = { name, when }
    }
    return newest
  }

  function serverRegistry() {
    let record = null
    const attached = () => liveClients().map(publicClient)

    return {
      name: 'engine-server-registry',

      resolveId: id => ([TAB_BEACON, TAB_BEACON_URL].includes(id) ? TAB_BEACON_MODULE : null),
      load: id => (id === TAB_BEACON_MODULE ? TAB_BEACON_SOURCE : null),
      transformIndexHtml: {
        order: 'pre',
        handler: () => [
          {
            tag: 'script',
            attrs: { type: 'module', src: TAB_BEACON_URL },
            injectTo: 'head'
          }
        ]
      },

      configureServer(server) {
        // Keyed by the raw socket, so a tab that closes takes its entry with it.
        // `mergeClient` decides whether an announcement may have the name it
        // asks for; this server holds the list and nothing more.
        // A page announces again every few seconds, so a socket refused once is
        // refused again. Warn per socket, or the log buries everything else.
        const warned = new WeakSet()
        const observed = new WeakSet()
        server.ws.on('engine:tab', (said, client) => {
          const socket = client.socket
          // Which checkout and project this is comes from the server, last, so a
          // page cannot report a project it is not being served.
          const merged = mergeClient(clients, socket, client, { ...said, project: PROJECT_NAME, serves: ROOT })
          if (merged.error) {
            if (!warned.has(socket)) {
              warned.add(socket)
              console.warn(
                `[engine] tab "${said?.id}" refused — ${merged.error}: ${describeClient(merged.existing)} holds that name`
              )
            }
            return
          }
          if (!observed.has(socket)) {
            observed.add(socket)
            socket.once?.('close', () => clients.delete(socket))
          }
        })

        // What this server is, asked over the wire. A record on disk says what was
        // true when it was written; this is the only thing that says what is true
        // now, which is why the CLI never reports an entry alive without it.
        server.middlewares.use(async (req, res, next) => {
          const url = new URL(req.url, 'http://x')
          if (url.pathname === '/api/server') {
            return send(res, 200, {
              ...(record || { serves: ROOT, project: PROJECT_NAME }),
              pid: process.pid,
              tabs: attached(),
              // The lane records as written. Proving one means asking its
              // debugging port, and a viewer polling this route must not wait on
              // that; `node bin/engine.mjs lanes` proves them.
              lanes: readLaneBrowsers(ROOT)
            })
          }

          // The last frame a lane captured, for a viewer that shows every lane.
          // Read only, one directory, and the client name never becomes a path.
          if (url.pathname === '/api/lane-frame') {
            const newest = await newestLaneFrame(url.searchParams.get('client') || '')
            if (!newest) return send(res, 404, { error: 'no frame for that client' })
            res.statusCode = 200
            res.setHeader('content-type', 'image/png')
            // Which capture this is, so a viewer can tell a new frame from the
            // one it already has.
            res.setHeader('x-engine-frame', newest.name)
            return res.end(await fs.readFile(path.join(SEE_DIRECTORY, newest.name)))
          }

          return next()
        })

        server.httpServer?.once('listening', () => {
          // The port that was asked for and the port that was got are different
          // things whenever another server already holds it, and the record has to
          // carry the one an agent can actually reach.
          const port = server.httpServer.address()?.port
          if (typeof port !== 'number') return
          record = {
            port,
            pid: process.pid,
            serves: ROOT,
            project: PROJECT_NAME,
            url: `http://localhost:${port}`,
            startedAt: new Date().toISOString()
          }
          try {
            recordServer(ROOT, record)
          } catch (error) {
            console.warn(`[engine] could not write the server registry: ${error?.message || error}`)
          }
        })

        const forget = () => {
          if (!record) return
          try {
            forgetServer(ROOT, record.port, record.pid)
          } catch {
            /* leaving a corpse is survivable; the reader proves liveness */
          }
          record = null
        }
        server.httpServer?.on('close', () => {
          forget()
          process.removeListener('exit', forget)
        })
        process.on('exit', forget)
      }
    }
  }

  // Returns nothing on purpose: Vite treats whatever `configureServer` resolves
  // to as a hook to call after its middlewares, and the writer answers the list
  // of paths it wrote.

  function openEditorWindow() {
    return {
      name: 'engine-open-editor',
      configureServer(server) {
        if (desktop || process.env.ENGINE_NO_OPEN) return
        server.httpServer?.once('listening', () => {
          const address = server.httpServer.address()
          const port = typeof address === 'object' ? address.port : server.config.server.port
          // Not awaited: the hook must not hold the server from listening. The
          // open is reported when it resolves.
          openPage(`http://localhost:${port}/`, { checkout: ROOT, profile: 'editor' })
            .then(opened => {
              console.log(
                opened.opened
                  ? `[engine] editor opened in ${opened.chrome}`
                  : `[engine] could not open the editor: ${opened.problem}`
              )
            })
            .catch(error => {
              console.log(`[engine] could not open the editor: ${error?.message || error}`)
            })
        })
      }
    }
  }

  const writeAgentDoc = async () => {
    await writeGeneratedAgentFiles(ROOT, PROJECT)
    for (const node of await pluginGuides(ROOT, PROJECT)) {
      if (!node.source) continue
      try {
        await agentInterface(node.scope, node.source)
      } catch (error) {
        console.warn(`[engine] could not update plugin interface: ${error.message}`)
      }
    }
  }

  return {
    plugins: [
      // bridge first: api() answers 404 for any unclaimed /api/ path, so anything
      // sharing that prefix has to register ahead of it.
      bridge(),
      serverRegistry(),
      serveProject(),
      api(),
      ...(!desktop ? [{ name: 'engine-agent-doc', configureServer: () => writeAgentDoc() }] : []),
      openEditorWindow()
    ],
    // Nothing about the project is baked into the page. It asks `/api/project`
    // for the name and fetches everything else under `/project/`, so a server
    // that repoints itself is followed rather than remembered.
    // ENGINE_PORT is the same variable `bin/engine.mjs` reads, so naming a port
    // once puts the server and the commands that drive it on the same one.
    server: {
      port: Number(process.env.ENGINE_PORT) || 5180,
      // The supervisor picks this port, names it in the instance record, and waits
      // on it. Left free, Vite binds the next free port instead and the wait
      // fails on a server that is running. A taken port must end the start with
      // Vite's own error, not move to a port the supervisor never learns.
      strictPort: true,
      // `engine-open-editor` opens the window. Vite's own `open` uses the system
      // opener, which gives the page to the browser the person already has open.
      open: false,
      watch: { ignored: file => !watched(file) },
      // The project may be outside the checkout, and `/@fs` refuses anything not
      // named here. The projects root is listed too, so opening another project
      // without restarting does not have to reopen this door.
      fs: { allow: [ROOT, projectsRoot(ROOT), PROJECT] }
    }
  }
}
