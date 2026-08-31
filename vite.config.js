import { defineConfig } from 'vite'
import fs from 'node:fs/promises'
import path from 'node:path'
// The index builder and the determinism lint live in the engine, not in this
// config, so a world running headless in node builds the same index from the
// same code. Two implementations of "what is in this project" would drift.
import { buildIndex as buildProjectIndex, problemsIn, fatal, walk, KIND, recordServer, forgetServer } from './engine/project-index.mjs'
import { writeGeneratedAgentFiles } from './engine/agent-registration.mjs'
import { chooseClient, describeClient, explainClientError, isLive, mergeClient, ownNonce, publicClient } from './engine/bridge-clients.mjs'
import { readLaneBrowsers } from './engine/lane-browsers.mjs'
import { workLock, permits, roleOfClient } from './engine/work-lock.mjs'

const ROOT = process.cwd()

/**
 * Which project this server serves.
 *
 * One parameter, `ENGINE_PROJECT`, naming a directory inside the checkout.
 * Unset means `project`, so a server started the way it always was serves
 * exactly what it always did.
 *
 * It must be a CHILD of the root and nothing further away. The browser fetches
 * project modules and assets by URL from this same root, and `agents/`, `docs/`
 * and the builtin plugin guides are resolved against the root beside it — a
 * project living elsewhere would give two directories that can disagree about
 * which checkout you are in.
 */
const PROJECT_DIRECTORY = process.env.ENGINE_PROJECT || 'project'
const PROJECT = path.join(ROOT, PROJECT_DIRECTORY)
if (path.dirname(PROJECT) !== ROOT) {
  throw new Error(
    `ENGINE_PROJECT must name a directory directly inside ${ROOT} — got ${JSON.stringify(PROJECT_DIRECTORY)}`)
}

/**
 * What the editor wrote most recently, per path.
 *
 * The editor saves on every edit, and the file watcher would report those saves
 * straight back as "the file changed", which would make the editor reload the
 * level it had just written. Compared by content rather than by a timer, so it
 * stays exact when a save is slow.
 */
const lastWritten = new Map()

/**
 * Is this path inside the project?
 *
 * Both separators, deliberately: Vite hands `handleHotUpdate` a path with
 * forward slashes while chokidar hands the watcher native ones, so comparing
 * with `path.sep` matches in one place and silently fails in the other.
 */
const slash = p => p.split(path.sep).join('/')
const PROJECT_URL = slash(PROJECT)
const PROJECT_ROOT_URL = slash(ROOT)
const inProject = p => slash(p).startsWith(PROJECT_URL + '/')

/** Project-relative, always forward-slashed. */
const relative = p => slash(p).slice(PROJECT_URL.length + 1)

/**
 * Whether the watcher should look at a path at all.
 *
 * Other tools leave scratch directories in the repo — dsh-agent writes
 * `tools/.dsh-agent.<pid>.<id>.tmpdir/` for as long as it runs. Watching one is
 * pointless, and on Windows it is fatal: the directory is locked and then
 * deleted under the watcher, which raises EBUSY. Dot-directories are never
 * project content, so none of them are watched.
 *
 * The test is made against the path RELATIVE to this server's own root, and
 * that is the whole point. A parallel agent's checkout lives inside
 * `.agent-worktrees/<lane>/`, so a pattern matched against the absolute path
 * ignored every single file that agent owned — the editor never saw one edit,
 * hot reload never fired, and the stale module cache made it look as though the
 * work had not been written. In the one workflow this engine exists to support.
 */
const watched = file => {
  const inside = slash(path.resolve(file)).slice(PROJECT_ROOT_URL.length)
  return !/(^|\/)\.[^/]/.test(inside)
}

const send = (res, code, body) => {
  res.statusCode = code
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify(body))
}

const readBody = req => new Promise(resolve => {
  let s = ''
  req.on('data', c => (s += c))
  req.on('end', () => resolve(s ? JSON.parse(s) : {}))
})

/** Reject anything that escapes the project directory. */
function safe(rel) {
  const abs = path.resolve(PROJECT, rel)
  if (abs !== PROJECT && !abs.startsWith(PROJECT + path.sep)) return null
  return abs
}

function safeAgent(scope, rel) {
  const base = scope === 'engine' ? ROOT : scope === 'project' ? PROJECT : null
  const clean = slash(String(rel || '')).replace(/^\.\//, '')
  const allowed = scope === 'engine'
    ? clean === 'AGENTS.md' || clean === 'ENGINE-BASE.md' || clean === 'ARCHITECTURE.md' || clean.startsWith('agents/') || clean.startsWith('docs/') || /^plugins\/builtin\/[^/]+\.agent\.md$/.test(clean)
    : clean.startsWith('agents/') || /^plugins\/[^/]+\.agent\.md$/.test(clean)
  if (!base || !allowed) return null
  const abs = path.resolve(base, clean)
  return abs.startsWith(base + path.sep) ? abs : null
}

/**
 * The op name the file routes are judged as.
 *
 * `POST /api/file` and `POST /api/agent-file` do one thing — put text at a
 * path — and that is `code.save`. Work Lock answers per op, so the routes have
 * to name one of the ops it knows writes a file.
 */
const FILE_ROUTE_OP = 'code.save'

/**
 * Whether a file-route write is refused, and why.
 *
 * These routes are the transport under `files.write`, so a lock on
 * `/api/engine` alone leaves every write from a page or a terminal open. The
 * caller's role comes from the lane registry, never from what it claims to be:
 * `engine/files.js` sends the page's announced name in `x-engine-client`, and a
 * request with no name is judged as the person.
 */
const refusedFileWrite = request => {
  const lock = workLock(ROOT)
  const role = roleOfClient(ROOT, String(request.headers['x-engine-client'] || ''))
  const { allowed, why } = permits(lock, FILE_ROUTE_OP, role)
  return allowed ? null : { ok: false, code: 'held', error: why, lock, serves: ROOT }
}

/** One project, one index. Rebuilt on every write, never cached. */
const buildIndex = () => buildProjectIndex(PROJECT)

async function agentPlugins() {
  const game = JSON.parse(await fs.readFile(path.join(PROJECT, 'game.json'), 'utf8'))
  const disabled = new Set(game.plugins?.disabled || [])
  const places = [
    { scope: 'engine', directory: path.join(ROOT, 'plugins/builtin'), prefix: 'plugins/builtin' },
    { scope: 'project', directory: path.join(PROJECT, 'plugins'), prefix: 'plugins' }
  ]
  const found = []
  for (const place of places) {
    let names = []
    try { names = await fs.readdir(place.directory) } catch { continue }
    for (const name of names.filter(name => name.endsWith('.agent.md')).sort()) {
      const stem = name.slice(0, -'.agent.md'.length)
      const source = await fs.readFile(path.join(place.directory, `${stem}.js`), 'utf8').catch(() => '')
      const plugin = source.match(/export\s+default\s+\{[\s\S]*?\bname:\s*['"]([^'"]+)['"]/m)?.[1] || stem
      // A guide applies to its own plugin by default. A leading frontmatter
      // `match:` (space-separated paths) adds more — Plugin Master uses it to
      // ride along with every plugin task.
      const guide = await fs.readFile(path.join(place.directory, name), 'utf8').catch(() => '')
      const declared = guide.match(/^---\s*\n([\s\S]*?)\n---/)?.[1]
      const extra = declared?.match(/^match:\s*(.+)$/m)?.[1]?.trim().split(/\s+/).filter(Boolean) || []
      // A guide may declare its own trigger words (comma-separated), so a task
      // that says "look at x" pulls the plugin that answers looking — and a
      // disabled plugin's words pull nothing, because the node is disabled
      // with it. This is what makes a guide a skill.
      const saidTriggers = declared?.match(/^triggers:\s*(.+)$/m)?.[1]?.split(',').map(word => word.trim().toLowerCase()).filter(Boolean) || []
      // Named from the project directory in use, not the literal `project` —
      // the same rule the headless twin follows, or the two disagree about
      // which file a project plugin's guide belongs to.
      const match = [...new Set([
        `${place.scope === 'project' ? PROJECT_DIRECTORY + '/' : ''}${place.prefix}/${stem}.js`,
        ...extra
      ])]
      found.push({
        id: `plugin-${place.scope}-${stem}`, title: plugin, kind: 'instruction', parent: 'plugins',
        scope: place.scope, file: `${place.prefix}/${name}`,
        match,
        triggers: [...new Set([stem.replaceAll('-', ' '), plugin.toLowerCase(), ...saidTriggers])],
        enabled: !disabled.has(plugin), plugin
      })
    }
  }
  return found
}

function api() {
  return {
    name: 'engine-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url, 'http://x')
        if (!url.pathname.startsWith('/api/')) return next()

        try {
          if (url.pathname === '/api/index') return send(res, 200, await buildIndex())

          // Answers "is what I just wrote valid?" without a reload: broken
          // imports, unreadable levels, and anything that breaks determinism.
          if (url.pathname === '/api/check') {
            const problems = problemsIn(await buildIndex())
            // `ok` follows the fatal ones. A warning is worth reading and never
            // worth failing on, and both callers of `problemsIn` agree on that
            // through the same function.
            return send(res, 200, { ok: fatal(problems).length === 0, problems })
          }

          if (url.pathname === '/api/tree') {
            const files = await walk(PROJECT)
            return send(res, 200, files.filter(f => !f.startsWith('.engine')).map(f => ({ path: f, kind: KIND(f) })))
          }

          if (url.pathname === '/api/agent-plugins') return send(res, 200, await agentPlugins())

          // Which project this server serves. A page is built with that name
          // baked in, so a server restarted onto a different project leaves a
          // live tab reading one project's index and fetching another project's
          // textures — and nothing on screen says so. This is how the tab asks.
          if (url.pathname === '/api/project') return send(res, 200, { project: PROJECT_DIRECTORY })

          if (url.pathname === '/api/file' && req.method === 'GET') {
            const abs = safe(url.searchParams.get('path') || '')
            if (!abs) return send(res, 400, { error: 'path outside project' })
            return send(res, 200, { text: await fs.readFile(abs, 'utf8') })
          }

          if (url.pathname === '/api/file' && req.method === 'POST') {
            const refused = refusedFileWrite(req)
            if (refused) return send(res, 423, refused)
            const { path: rel, text } = await readBody(req)
            const abs = safe(rel || '')
            if (!abs) return send(res, 400, { error: 'path outside project' })
            await fs.mkdir(path.dirname(abs), { recursive: true })
            lastWritten.set(rel, text)
            await fs.writeFile(abs, text, 'utf8')
            await buildIndex()
            return send(res, 200, { ok: true })
          }

          if (url.pathname === '/api/agent-file' && req.method === 'GET') {
            const abs = safeAgent(url.searchParams.get('scope'), url.searchParams.get('path'))
            if (!abs) return send(res, 400, { error: 'bad agent file path' })
            return send(res, 200, { text: await fs.readFile(abs, 'utf8') })
          }

          if (url.pathname === '/api/agent-file' && req.method === 'POST') {
            const refused = refusedFileWrite(req)
            if (refused) return send(res, 423, refused)
            const { scope, path: rel, text } = await readBody(req)
            const abs = safeAgent(scope, rel)
            if (!abs) return send(res, 400, { error: 'bad agent file path' })
            await fs.mkdir(path.dirname(abs), { recursive: true })
            await fs.writeFile(abs, text, 'utf8')
            if (scope === 'project') await buildIndex()
            if (scope === 'engine' && rel === 'agents/bootstrap.md') await writeAgentDoc()
            return send(res, 200, { ok: true })
          }

          return send(res, 404, { error: 'no such endpoint' })
        } catch (e) {
          return send(res, 500, { error: String(e.message || e) })
        }
      })
    }
  }
}

/**
 * Every page attached to this server, keyed by its websocket.
 *
 * Shared by the bridge and the server registry: the registry learns who is
 * there from the tab beacon, and the bridge needs the same list to send a call
 * to one of them rather than to all.
 */
const clients = new Map()

const liveClients = () => [...clients.values()].filter(isLive)

/**
 * Relay between a terminal and the live editor.
 *
 * `POST /api/engine {op, args, client}` goes to one page over the dev-server
 * websocket; the Terminal Bridge plugin answers from inside it. This exists so
 * the engine is not the thing that hosts an AI — it is the thing an AI attaches
 * to, whichever one the user happens to run.
 */
function bridge() {
  const waiting = new Map()
  let seq = 0

  return {
    name: 'engine-bridge',

    /**
     * Take project files out of Vite's hands.
     *
     * A type is pulled in with a dynamic import, so it lives in Vite's module
     * graph, and nothing declares `import.meta.hot.accept` for it — Vite's
     * answer to that is a full page reload. Which throws away the world you
     * were inspecting, every time you edit a type. Returning an empty list
     * says "no modules to update here"; Live File Updates handles it instead, from
     * the watcher event below.
     *
     * Editor source (`engine/`, `plugins/`) is deliberately not covered: a
     * full reload is the right answer for the editor itself.
     */
    handleHotUpdate({ file, server }) {
      if (!inProject(file)) return

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
      console.log(`[engine] serving project: ${PROJECT_DIRECTORY}`)

      /**
       * A watcher error must not end the session.
       *
       * Chokidar reports a file it cannot watch by emitting `error`, and an
       * unhandled one on an EventEmitter takes the whole dev server down. A
       * file another process has locked is a normal thing on Windows and is
       * not worth losing the editor over. Report it by name and keep serving.
       */
      server.watcher.on('error', error => {
        console.warn(`[engine] file watcher: ${error?.message || error}`)
      })

      /**
       * Tell the editor what changed on disk.
       *
       * The point is that an agent writes a file with its ordinary file tools —
       * no engine-specific write API — and the running editor picks it up. So
       * the signal has to come from the filesystem, not from a save endpoint.
       */
      server.watcher.on('all', async (event, abs) => {
        if (!inProject(abs)) {
          if (slash(abs) === slash(path.join(ROOT, 'agents/bootstrap.md')) && event !== 'unlink') await writeAgentDoc()
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
        try { await buildIndex() } catch (error) {
          console.warn(`[engine] could not rebuild the index: ${error?.message || error}`)
        }
        server.ws.send('engine:changed', {
          event,                                   // add | change | unlink
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
            ok: false, code: 'held', error: held, lock, serves: ROOT
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

/**
 * Write down that this server exists, and who is looking at it.
 *
 * Nothing used to track a dev server or the tabs attached to it, so cleanup was
 * a hunt through Task Manager and the two failures it caused were invisible: a
 * forgotten server on the expected port serves a different project, and a hidden
 * tab answers a capture with a blank frame. `node bin/engine.mjs servers` reads
 * what is written here, and `servers.stop` ends it.
 *
 * The record is best effort and is never believed on its own. A server killed
 * with `taskkill /F` gets no chance to tidy up, so the reader proves every entry
 * by asking the port instead of trusting the file.
 */
const TAB_BEACON = 'virtual:engine-tab-beacon'
const TAB_BEACON_MODULE = '\0' + TAB_BEACON
const TAB_BEACON_URL = '/@id/__x00__' + TAB_BEACON

/**
 * The page's half, injected into every document this server serves.
 *
 * Whether a tab is hidden is a fact only the page holds — the server sees a
 * websocket and cannot tell a foreground editor from one buried behind twenty
 * others. So the tab says so itself, at load and at every change, and the
 * listing can name the cause of a blank frame instead of guessing at it.
 */
const TAB_BEACON_SOURCE = `
const hot = import.meta.hot
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
  if (asked) globalThis.__engineViewer = id
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
  const WHAT = ${JSON.stringify(PROJECT_DIRECTORY)} + ' :' + location.port

  /**
   * Say that this page's server has gone.
   *
   * A dead tab keeps its last frame and still answers a click, so nothing on
   * screen says the editor behind it has stopped. The banner covers the page so
   * the state is readable without clicking into the tab.
   */
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

/** Where a lane's captures are written. Read from, never written to, here. */
const SEE_DIRECTORY = path.join(ROOT, 'agent-runs/see')

/**
 * The newest capture whose filename names this client, or null.
 *
 * The name is matched against filenames this function itself listed, never
 * joined into a path, so no name reaches outside `agent-runs/see`.
 */
async function newestLaneFrame(client) {
  if (!client || /[\\/]/.test(client)) return null
  let names = []
  try { names = await fs.readdir(SEE_DIRECTORY) } catch { return null }
  let newest = null
  for (const name of names.filter(name => name.endsWith('.png') && name.includes(client))) {
    const when = await fs.stat(path.join(SEE_DIRECTORY, name)).then(stat => stat.mtimeMs, () => null)
    if (when !== null && (!newest || when > newest.when)) newest = { name, when }
  }
  return newest
}

function serverRegistry() {
  let record = null
  const attached = () => liveClients().map(publicClient)

  return {
    name: 'engine-server-registry',

    resolveId: id => (id === TAB_BEACON ? TAB_BEACON_MODULE : null),
    load: id => (id === TAB_BEACON_MODULE ? TAB_BEACON_SOURCE : null),
    transformIndexHtml: () => [{
      tag: 'script', attrs: { type: 'module', src: TAB_BEACON_URL }, injectTo: 'head'
    }],

    configureServer(server) {
      // Keyed by the raw socket, so a tab that closes takes its entry with it.
      // `mergeClient` decides whether an announcement may have the name it
      // asks for; this server holds the list and nothing more.
      // A page announces again every few seconds, so a socket refused once is
      // refused again. Warn per socket, or the log buries everything else.
      const warned = new WeakSet()
      server.ws.on('engine:tab', (said, client) => {
        const socket = client.socket
        // Which checkout and project this is comes from the server, last, so a
        // page cannot report a project it is not being served.
        const merged = mergeClient(clients, socket, client,
          { ...said, project: PROJECT_DIRECTORY, serves: ROOT })
        if (merged.error) {
          if (!warned.has(socket)) {
            warned.add(socket)
            console.warn(`[engine] tab "${said?.id}" refused — ${merged.error}: ${describeClient(merged.existing)} holds that name`)
          }
          return
        }
        socket.once?.('close', () => clients.delete(socket))
      })

      // What this server is, asked over the wire. A record on disk says what was
      // true when it was written; this is the only thing that says what is true
      // now, which is why the CLI never reports an entry alive without it.
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url, 'http://x')
        if (url.pathname === '/api/server') {
          return send(res, 200, {
            ...(record || { serves: ROOT, project: PROJECT_DIRECTORY }),
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
          project: PROJECT_DIRECTORY,
          url: `http://localhost:${port}`,
          startedAt: new Date().toISOString()
        }
        try { recordServer(ROOT, record) } catch (error) {
          console.warn(`[engine] could not write the server registry: ${error?.message || error}`)
        }
      })

      const forget = () => {
        if (!record) return
        try { forgetServer(ROOT, record.port, record.pid) } catch { /* leaving a corpse is survivable; the reader proves liveness */ }
        record = null
      }
      server.httpServer?.on('close', forget)
      process.on('exit', forget)
    }
  }
}

/**
 * AGENTS.md, CLAUDE.md and the generated skills, written at server start.
 *
 * The rule for what they contain is in engine/agent-registration.mjs, and this
 * calls it rather than repeating it, so `node bin/engine.mjs check` reports
 * them against the same rule that writes them. It also reads the source per
 * write, so an edit while the server runs reaches the generated files.
 */
// Returns nothing on purpose: Vite treats whatever `configureServer` resolves
// to as a hook to call after its middlewares, and the writer answers the list
// of paths it wrote.
const writeAgentDoc = async () => { await writeGeneratedAgentFiles(ROOT, PROJECT_DIRECTORY) }

export default defineConfig({
  plugins: [
    // bridge first: api() answers 404 for any unclaimed /api/ path, so anything
    // sharing that prefix has to register ahead of it.
    bridge(),
    serverRegistry(),
    api(),
    { name: 'engine-agent-doc', configureServer: () => writeAgentDoc() }
  ],
  /**
   * Tell the browser half the same directory name.
   *
   * The browser cannot read an env var, and the two halves have to agree or the
   * editor reads its levels from one project and fetches its textures from
   * another. `engine/asset-path.js` is the single reader.
   *
   * It has to go through `import.meta.env`. A bare defined identifier is only
   * substituted by a production build — Vite's define plugin returns without
   * doing anything in dev — so the editor, which is the only thing anyone runs,
   * would quietly keep using `project`.
   */
  define: { 'import.meta.env.ENGINE_PROJECT': JSON.stringify(PROJECT_DIRECTORY) },
  // ENGINE_NO_OPEN keeps a headless or CI run from launching a visible browser.
  // ENGINE_PORT is the same variable `bin/engine.mjs` reads, so naming a port
  // once puts the server and the commands that drive it on the same one.
  server: {
    port: Number(process.env.ENGINE_PORT) || 5180,
    open: !process.env.ENGINE_NO_OPEN,
    watch: { ignored: file => !watched(file) }
  }
})
