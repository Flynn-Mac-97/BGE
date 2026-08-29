import { defineConfig } from 'vite'
import fs from 'node:fs/promises'
import path from 'node:path'
// The index builder and the determinism lint live in the engine, not in this
// config, so a world running headless in node builds the same index from the
// same code. Two implementations of "what is in this project" would drift.
import { buildIndex as buildProjectIndex, problemsIn, walk, KIND } from './engine/project-index.mjs'

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
const inProject = p => slash(p).startsWith(PROJECT_URL + '/')

/** Project-relative, always forward-slashed. */
const relative = p => slash(p).slice(PROJECT_URL.length + 1)

/** What the file watcher skips, said in absolute paths under this checkout. */
const IGNORED = ['**/.*/**', '**/.agent-worktrees/**', '**/.tmp-agent-tests/**']
  .map(pattern => `${slash(ROOT)}/${pattern}`)

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
        triggers: [stem.replaceAll('-', ' '), plugin.toLowerCase()], enabled: !disabled.has(plugin), plugin
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
            return send(res, 200, { ok: problems.length === 0, problems })
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
 * Relay between a terminal and the live editor.
 *
 * `POST /api/engine {op, args}` is broadcast over the dev-server websocket;
 * the Terminal Bridge plugin answers from inside the page. This exists so the
 * engine is not the thing that hosts an AI — it is the thing an AI attaches
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

        await buildIndex()
        server.ws.send('engine:changed', {
          event,                                   // add | change | unlink
          file: rel,
          kind: KIND(rel),
          name: path.basename(rel).replace(/\.[^.]+$/, '')
        })
      })

      server.ws.on('engine:reply', message => {
        const resolve = waiting.get(message.id)
        // A second open tab answers too. First reply wins; the rest are dropped.
        if (!resolve) return
        waiting.delete(message.id)
        resolve(message)
      })

      server.middlewares.use(async (req, res, next) => {
        if (req.url.split('?')[0] !== '/api/engine' || req.method !== 'POST') return next()

        const { op, args = [], timeout = 8000 } = await readBody(req)
        if (!op) return send(res, 400, { error: 'missing op' })

        const id = ++seq
        const pending = new Promise(resolve => {
          waiting.set(id, resolve)
          setTimeout(() => {
            if (waiting.delete(id)) {
              resolve({
                ok: false,
                code: 'no-client',
                error: 'no editor attached. Open http://localhost:5180 and leave the tab open.'
              })
            }
          }, timeout)
        })
        server.ws.send('engine:call', { id, op, args })

        const reply = await pending
        return send(res, reply.ok ? 200 : 502, reply)
      })
    }
  }
}

/**
 * AGENTS.md is how a CLI that has never seen this project learns to drive it.
 * Written at server start so it can never drift from a stale checkout, and
 * never overwritten by hand-edits being lost — it is generated, say so in it.
 */
async function writeAgentDoc() {
  await fs.writeFile(path.join(ROOT, 'AGENTS.md'), AGENT_DOC, 'utf8')

  // Claude Code reads CLAUDE.md. Point at the same file rather than duplicating
  // it, and never clobber one the user already wrote.
  const claude = path.join(ROOT, 'CLAUDE.md')
  try { await fs.access(claude) } catch {
    await fs.writeFile(claude, 'See [AGENTS.md](AGENTS.md) — it is generated and always current.\n', 'utf8')
  }
}

const AGENT_DOC = await fs.readFile(path.join(ROOT, 'agents/bootstrap.md'), 'utf8')

export default defineConfig({
  plugins: [
    // bridge first: api() answers 404 for any unclaimed /api/ path, so anything
    // sharing that prefix has to register ahead of it.
    bridge(),
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
  server: {
    port: 5180,
    open: !process.env.ENGINE_NO_OPEN,
    // Other tools leave scratch directories in the repo — dsh-agent writes
    // `tools/.dsh-agent.<pid>.<id>.tmpdir/` for as long as it runs. Watching
    // one is pointless, and on Windows it is fatal: the directory is locked
    // and then deleted under the watcher, which raises EBUSY. Dot-directories
    // are never project content, so none of them are watched.
    //
    // Anchored to ROOT, and that is the whole point. Chokidar matches these
    // against absolute paths, so the bare `**/.*/**` meant "any path with a
    // dot-directory anywhere in it" — and a parallel agent's checkout lives at
    // `<repo>/.agent-worktrees/<lane>/`, so the lane's dev server ignored every
    // file it was serving. The page reloaded, Vite served the cached transform
    // because nothing had invalidated it, and the plugin you had just rewritten
    // behaved exactly as before, silently.
    watch: { ignored: IGNORED }
  }
})
