import { defineConfig } from 'vite'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = process.cwd()
const PROJECT = path.join(ROOT, 'project')

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

async function walk(directory, base = '') {
  const out = []
  let items = []
  try { items = await fs.readdir(directory, { withFileTypes: true }) } catch { return out }
  for (const it of items) {
    if (it.name.startsWith('.')) continue
    const rel = base ? `${base}/${it.name}` : it.name
    if (it.isDirectory()) out.push(...await walk(path.join(directory, it.name), rel))
    else out.push(rel)
  }
  return out
}

/**
 * Reaching around the engine's clock, random stream or scheduler.
 *
 * Each of these makes a run unrepeatable, which quietly breaks `simulate()` —
 * the thing the whole change-run-compare loop rests on. They are reported
 * rather than blocked: it is the author's project, but nobody should discover
 * this by watching two identical runs disagree.
 */
const BANNED = [
  [/\bperformance\s*\.\s*now\s*\(/, 'performance.now() is the wall clock — use context.time'],
  [/\bDate\s*\.\s*now\s*\(/, 'Date.now() is the wall clock — use context.time'],
  [/\bnew\s+Date\s*\(/, 'new Date() is the wall clock — use context.time'],
  [/\bMath\s*\.\s*random\s*\(/, 'Math.random() cannot be replayed — use context.random()'],
  [/\bsetTimeout\s*\(/, 'setTimeout runs on the wall clock — use context.after(seconds, fn)'],
  [/\bsetInterval\s*\(/, 'setInterval runs on the wall clock — use context.every(seconds, fn)'],
  [/\brequestAnimationFrame\s*\(/, 'requestAnimationFrame does not run in a hidden tab — use the update hook']
]

/** Report determinism problems in one file, with line numbers. */
function lint(file, text) {
  const out = []
  text.split('\n').forEach((line, i) => {
    if (/^\s*(\/\/|\*)/.test(line)) return          // a comment may name them
    for (const [re, why] of BANNED) {
      if (re.test(line)) out.push({ file, line: i + 1, why, code: line.trim().slice(0, 80) })
    }
  })
  return out
}

const KIND = f =>
  f.startsWith('types/')  ? 'type'
  : f.startsWith('behaviours/') ? 'behaviour'
  : f.startsWith('levels/') ? 'level'
  : f.startsWith('tests/') ? 'test'
  : /\.(png|jpg|jpeg|webp|gif|svg)$/i.test(f) ? 'image'
  : /\.(wav|mp3|ogg)$/i.test(f) ? 'sound'
  : /\.(glb|gltf)$/i.test(f) ? 'model'
  : 'config'

const HOOKS = ['start', 'update', 'onCollide', 'onDestroy']

/** The names in an attachment list, whichever of the two forms it was written in. */
const attachedNames = v =>
  !v ? []
  : Array.isArray(v) ? v.filter(n => typeof n === 'string')
  : Object.entries(v).filter(([, config]) => config !== false).map(([n]) => n)

/**
 * Build .engine/index.json — the one artifact both the browser UI and the AI read.
 * Types are imported rather than parsed so `properties` and asset references are exact.
 */
async function buildIndex() {
  const files = await walk(PROJECT)
  const index = { types: {}, behaviours: {}, levels: {}, tests: {}, assets: {}, config: [], warnings: [] }

  for (const f of files) {
    const kind = KIND(f)

    // Every hand-written JS file in the project runs inside the fixed step, so
    // every one of them is held to the determinism rules.
    if (f.endsWith('.js')) {
      index.warnings.push(...lint(f, await fs.readFile(path.join(PROJECT, f), 'utf8')))
    }

    if (kind === 'type') {
      const name = path.basename(f, '.js')
      const entry = { file: f, properties: [], uses: [], inLevels: 0 }
      try {
        const url = pathToFileURL(path.join(PROJECT, f)).href + '?t=' + Date.now()
        const loaded = (await import(url)).default || {}
        entry.properties = Object.keys(loaded.properties || {})
        // Every way a type can name a file, in one place. `sprite` is a string
        // when simple and an object when detailed, and an object may point at a
        // single `image` or a `sheet` — miss any of these and "used by" quietly
        // goes empty, which reads as "nothing uses this, safe to delete".
        const image = typeof loaded.sprite === 'string'
          ? loaded.sprite
          : (loaded.sprite?.sheet || loaded.sprite?.image)
        entry.uses = [image, loaded.model, ...Object.values(loaded.sounds || {})]
          .filter(v => typeof v === 'string')
        entry.hooks = HOOKS.filter(h => typeof loaded[h] === 'function')
        if (loaded.animation) entry.animation = Object.keys(loaded.animation)
        // What this type composes. Listed here so "what does a crate do" is one
        // index lookup rather than opening the type and then every behaviour.
        const attached = attachedNames(loaded.behaviours)
        if (attached.length) entry.behaviours = attached
      } catch (e) {
        entry.error = String(e.message || e)
      }
      index.types[name] = entry
    }

    else if (kind === 'behaviour') {
      const name = path.basename(f, '.js')
      const entry = { file: f, properties: {}, hooks: [], usedBy: [] }
      try {
        const url = pathToFileURL(path.join(PROJECT, f)).href + '?t=' + Date.now()
        const loaded = (await import(url)).default || {}
        // Values, not just keys, unlike a type. A behaviour is attached from a
        // list without ever opening it, so its defaults have to be readable
        // from here or nobody knows what they are agreeing to.
        entry.properties = loaded.properties || {}
        entry.hooks = HOOKS.filter(h => typeof loaded[h] === 'function')
        if (loaded.about) entry.about = String(loaded.about)
      } catch (e) {
        entry.error = String(e.message || e)
      }
      index.behaviours[name] = entry
    }

    else if (kind === 'level') {
      const name = path.basename(f, '.json')
      try {
        const raw = JSON.parse(await fs.readFile(path.join(PROJECT, f), 'utf8'))
        const placed = raw.entities || []
        index.levels[name] = {
          file: f,
          entities: placed.length,
          types: [...new Set(placed.map(e => e.type))],
          // Behaviours attached per placement rather than by the type. Without
          // this, a behaviour used only in a level reads as unreferenced.
          behaviours: [...new Set(placed.flatMap(e => attachedNames(e.behaviours)))]
        }
      } catch (e) {
        index.levels[name] = { file: f, error: String(e.message || e) }
      }
    }

    else if (kind === 'test') {
      const name = path.basename(f, '.js')
      const entry = { file: f }
      try {
        const url = pathToFileURL(path.join(PROJECT, f)).href + '?t=' + Date.now()
        const loaded = (await import(url)).default || {}
        if (loaded.name) entry.title = loaded.name
        if (loaded.level) entry.level = loaded.level
      } catch (e) {
        entry.error = String(e.message || e)
      }
      index.tests[name] = entry
    }

    else if (kind === 'config') index.config.push(f)
    else index.assets[path.basename(f)] = { file: f, kind, usedBy: [] }
  }

  // relationships: assets -> types that reference them, types -> levels that place them
  for (const [tn, t] of Object.entries(index.types)) {
    for (const u of t.uses) if (index.assets[u]) index.assets[u].usedBy.push(tn)
    for (const bn of t.behaviours || []) if (index.behaviours[bn]) index.behaviours[bn].usedBy.push(tn)
  }
  for (const [ln, l] of Object.entries(index.levels)) {
    for (const tn of l.types || []) if (index.types[tn]) index.types[tn].inLevels++
    for (const bn of l.behaviours || []) if (index.behaviours[bn]) index.behaviours[bn].usedBy.push(ln)
  }

  await fs.mkdir(path.join(PROJECT, '.engine'), { recursive: true })
  await fs.writeFile(path.join(PROJECT, '.engine/index.json'), JSON.stringify(index, null, 2))
  return index
}

/** Every attachment, from a type or a level, that names a behaviour file that is not there. */
function missingAttachments(index) {
  const out = []
  const check = (names, file, where) => {
    for (const n of names || []) {
      if (!index.behaviours[n]) out.push({ file, why: `${where} attaches behaviour "${n}" — no project/behaviours/${n}.js` })
    }
  }
  for (const [name, t] of Object.entries(index.types)) check(t.behaviours, t.file, `type "${name}"`)
  for (const [name, l] of Object.entries(index.levels)) check(l.behaviours, l.file, `level "${name}"`)
  return out
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
            const index = await buildIndex()
            const problems = [
              ...Object.entries(index.types).filter(([, t]) => t.error)
                .map(([name, t]) => ({ file: t.file, why: `type "${name}" failed to load — ${t.error}` })),
              ...Object.entries(index.behaviours).filter(([, b]) => b.error)
                .map(([name, b]) => ({ file: b.file, why: `behaviour "${name}" failed to load — ${b.error}` })),
              ...Object.entries(index.levels).filter(([, l]) => l.error)
                .map(([name, l]) => ({ file: l.file, why: `level "${name}" is not valid JSON — ${l.error}` })),
              // An attachment naming a file that is not there is silent at
              // runtime except for one console line, and the symptom is an
              // entity that simply does not do the thing. Catch it here.
              ...missingAttachments(index),
              ...Object.entries(index.tests).filter(([, t]) => t.error)
                .map(([name, t]) => ({ file: t.file, why: `test "${name}" failed to load — ${t.error}` })),
              ...index.warnings
            ]
            return send(res, 200, { ok: problems.length === 0, problems })
          }

          if (url.pathname === '/api/tree') {
            const files = await walk(PROJECT)
            return send(res, 200, files.filter(f => !f.startsWith('.engine')).map(f => ({ path: f, kind: KIND(f) })))
          }

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
      /**
       * Tell the editor what changed on disk.
       *
       * The point is that an agent writes a file with its ordinary file tools —
       * no engine-specific write API — and the running editor picks it up. So
       * the signal has to come from the filesystem, not from a save endpoint.
       */
      server.watcher.on('all', async (event, abs) => {
        if (!inProject(abs)) return
        const rel = relative(abs)
        if (rel.startsWith('.engine/') || path.basename(rel).startsWith('.')) return

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

const AGENT_DOC = `<!-- generated by vite.config.js on dev server start; edits are overwritten -->
# Driving this engine

A game engine that runs in the browser. You edit plain files on disk, and you
can read and drive the *running* editor from this terminal.

Start it (if it is not already up): \`npm run dev\` — http://localhost:5180

## Files

Depth 1 everywhere, one file per thing.

\`\`\`
project/types/*.js       what things ARE and DO  (data + 4 hooks in one file)
project/behaviours/*.js  one trait, shared by any number of types
project/levels/*.json    where things are placed  (overrides are visible JSON)
project/tests/*.js       checks that survive the session that wrote them
project/assets/          sprites, sounds, models
project/plugins/*.js     editor extensions
project/.engine/index.json   generated map of everything, and what uses what
\`\`\`

A type declares \`properties\` — that doubles as the inspector schema. Hooks are
\`start\`, \`update\`, \`onCollide\`, \`onDestroy\`, and there are no others.
There is no save button; every editor edit writes to disk immediately.

Names are spelled out. \`properties\` not props, \`context\` not ctx,
\`entity\` not e, \`seconds\` not dt. A short name saves nothing worth having
when the reader is meeting the code for the first time.

Sprites: \`sprite: 'coin.png'\`, or \`{ image, width, height, tile }\`. A bare
name means \`assets/\`. The sprite sets how big a thing draws, the collider sets
how big it hits, and \`tile\` repeats the texture instead of stretching it. A
texture that fails to load falls back to a flat colour and reports itself in
\`errors\`. Demo art is generated from text by \`node tools/make-sprites.mjs\`.

## The runtime

Four features, four declarations. All follow the same rule as everything else:
data in the type file, one flat key, a string when simple and an object when
detailed. \`ARCHITECTURE.md\` explains how they fit together.

\`\`\`js
// types/player.js
sprite:    { sheet: 'player.png', size: [16, 16], width: 0.9, height: 0.9 },
animation: { idle: 0, walk: { frames: [1, 2], framesPerSecond: 8 }, jump: { frames: [3], loop: false } },
sounds:    { jump: 'jump.wav', hurt: 'hurt.wav' },

update(entity, seconds, context) {
  const move = context.input.axis('x')
  entity.animation = !entity.grounded ? 'jump' : move ? 'walk' : 'idle'  // assignment, not play()
  entity.flip = move < 0                                    // mirrors art, not collider
  if (context.input.held('jump') && entity.grounded) entity.play('jump')
}
\`\`\`

**Animation is assignment.** Setting the same clip every frame does nothing, so
a hook can state what the entity *is* doing without tracking what it *was*
doing. A one-shot clip sets \`entity.animationDone\`.

**Sound is recorded even when silent.** A headless run still answers "did that
make a noise": \`node bin/engine.mjs run audio.recent\`.

**Camera and HUD are declared in the level**, because following the player and
showing a score belong to the level rather than to the player:

\`\`\`json
"camera": { "follow": "player", "lerp": 0.12, "lookAhead": 0.3, "bounds": [0,0,30,12] },
"hud": [
  { "text": "SCORE {score}", "at": [14, 12] },
  { "text": "{coins} COINS LEFT", "at": [-14, 12], "anchor": "top-right" },
  { "bar": "{health}", "max": 3, "at": [14, 34], "size": [90, 8] }
]
\`\`\`

\`{name}\` reads \`world.state.name\` — the state game code already writes to.
The game camera and the editor viewport are separate: the editor's view is
saved on play and restored on stop. From code: \`context.camera.follow(e)\`,
\`context.camera.moveTo(x, y)\`, \`context.camera.shake(0.35)\`.

Read them back without a screenshot:

\`\`\`
node bin/engine.mjs run hud.read          # what the HUD currently says
node bin/engine.mjs run camera.state      # where the camera is, and what it follows
node bin/engine.mjs run audio.recent      # what has played
node bin/engine.mjs run animation.list         # every clip, by type
\`\`\`

## Behaviours — the only kind of composition

A behaviour is one shared trait: a file shaped exactly like a type, minus the
art. Any number of types can attach it, and so can a single placement.

\`\`\`js
// project/behaviours/float.js
export default {
  about: 'bob up and down around where it started',
  properties: { speed: 2, amplitude: 0.3 },
  start(entity, context, self)           { self.base = entity.y },
  update(entity, seconds, context, self) {
    entity.y = self.base + Math.sin(context.time * self.speed) * self.amplitude
  }
}
\`\`\`

\`self\` is the behaviour's own bag on the entity — its properties to begin
with, plus whatever running state it puts there. The bag is also reachable as
\`entity.float\`. Keep state in \`self\`, never on the entity directly, and two
behaviours on one entity can never collide over a name.

Attach from a type, so every one of them gets it:

\`\`\`js
// types/crate.js
behaviours: ['float', 'breakable'],
behaviours: { float: { speed: 4 } },     // or with the defaults changed
\`\`\`

Attach from one placement, so only that one gets it:

\`\`\`json
{ "type": "crate", "at": [3, 1, 0], "behaviours": { "float": { "amplitude": 1.5 } } }
{ "type": "crate", "at": [5, 1, 0], "behaviours": { "float": false } }
\`\`\`

\`false\` takes off something the type declared, for this placement only. A
level only ever records what the placement itself decided — never the list it
inherited — so a diff shows a decision rather than a copy.

**Order is the order they are written**, and the type's own hooks run last, so
a type always gets the final word on what it composed. **A behaviour cannot
look up another behaviour.** If two must agree, they do it by reading and
writing plain fields on the entity. That single rule is what keeps this from
turning into a component graph.

\`\`\`
node bin/engine.mjs run behaviour.list                          # all of them, with defaults
node bin/engine.mjs run behaviour.attach '["crate-1","float"]'
node bin/engine.mjs run behaviour.attach '["crate-1","float",{"speed":4}]'
node bin/engine.mjs run behaviour.detach '["crate-1","float"]'
\`\`\`

In the editor: drag a behaviour out of the Project panel and drop it **on an
entity** in the viewport. Dropping a *type* on empty space places one instead.
The Inspector lists what an entity composes, what each is set to, whether it
came from the type or from this placement, and a button to take it off.

\`node bin/engine.mjs check\` fails if a type or level attaches a behaviour
whose file is not there — otherwise the only symptom is a thing that quietly
does not do what you asked.

Read \`project/.engine/index.json\` first. It answers "what exists, what uses
what" in one file, which is cheaper than reading every type. Behaviour entries
carry their default *values*, not just key names, so you can attach one without
opening it.

## Driving the live editor

\`\`\`
node bin/engine.mjs <op> [args...]
\`\`\`

Requires an editor tab to be open — a headless one counts, see below. Output is
JSON on stdout, compact when captured and indented at a terminal. Exit 0 ok,
1 error, 2 no editor attached.

| Command | Does |
|---|---|
| \`snapshot\` | mode, level, counts, selection, byType, recent errors |
| \`snapshot --entities --log --plugins\` | detail, on request only |
| \`commands\` | every verb the editor has, including plugin-contributed |
| \`run <id> [arg]\` | run one of those verbs |
| \`entity <id>\` | one entity's placement and properties |
| \`select <id...>\` | change the selection |
| \`set <id> <key> <value>\` | set a prop or field, persisted to the level file |
| \`spawn <type> '{"at":[1,2,0]}'\` | add an entity |
| \`destroy <id>\` | remove one |
| \`play\` / \`stop\` | enter and leave play mode |
| \`simulate <seconds>\` | step the fixed clock deterministically, return state |
| \`errors\` / \`log [n]\` / \`watch\` | what went wrong, live |
| \`eval '<js>'\` | escape hatch, runs in the page, \`await\` allowed |
| \`index\` / \`tree\` | project map and file list (no editor needed) |
| \`tests.run [id]\` | run the project's tests — see below |
| \`check\` | exits 1 if anything is broken or nondeterministic |
| \`seed <n>\` | re-seed the random stream and restart the clock |

Any command id from \`commands\` also works as a CLI verb, so a plugin that adds
a command has added a terminal verb with it.

Arguments that parse as JSON are passed as JSON; everything else is a string.
So \`set coin-7 value 99\` sets a number, \`run code.open types/coin.js\` a string.
In PowerShell, wrap JSON arguments in single quotes *and* verify the result —
PowerShell strips inner double quotes, and the argument silently arrives as a
string. Bash and cmd are fine.

A level file records where things START. Once you simulate or play, the world
holds where things ENDED, so saving is refused until you \`stop\` — which
reloads the level. Run \`stop\` before editing anything you want written.

### The one that matters

\`\`\`
node bin/engine.mjs simulate 1.5
\`\`\`

Advances the simulation 1.5 seconds without real time and without a visible
tab, then returns the full state. "What happens if this runs for two seconds"
is one call, not a video. Use it to verify a change instead of asking the user
to look at the screen.

**It is exactly repeatable, and that is a rule the engine enforces.** Same
level, same seed, same number of steps — same answer, every time. That only
holds because game code cannot reach the wall clock, so:

| Do not use | Use instead |
|---|---|
| \`performance.now()\`, \`Date.now()\`, \`new Date()\` | \`context.time\` — engine seconds since the level loaded |
| \`Math.random()\` | \`context.random()\`, plus \`.int(a,b)\` \`.range(a,b)\` \`.pick(list)\` \`.chance(p)\` |
| \`setTimeout\` | \`context.after(seconds, fn)\` |
| \`setInterval\` | \`context.every(seconds, fn)\` — both return an id for \`context.cancel(id)\` |
| \`requestAnimationFrame\` | the \`update\` hook |

\`node bin/engine.mjs check\` fails on any of the left column, with the file and
line. Run it after writing a type — it is much cheaper than discovering it when
two identical runs disagree.

\`engine.seed(n)\` re-seeds and restarts the clock. Varying the seed is how you
check that behaviour holds generally rather than by luck.

### No screen needed

The editor is a normal page, so headless Chrome can be the client. WebGL, the
renderer, physics and collisions all work, and the canvas can still be read
back as a PNG. Nothing about driving it changes.

\`\`\`
ENGINE_NO_OPEN=1 npx vite --port 5181 &
chrome --headless=new --disable-gpu --remote-debugging-port=9223 \\
       --user-data-directory=/tmp/engine-profile http://localhost:5181 &
node bin/engine.mjs simulate 1.5 --port 5181
\`\`\`

## Tests

**Write one instead of a throwaway script.** A shell one-liner that proves your
change works is gone when the session ends; a file in \`project/tests/\` is still
there next time, shows up in the editor, and tells the next agent what the
behaviour is supposed to be. Prefer adding a test to re-deriving the check.

\`\`\`js
// project/tests/coin-pickup.js
export default {
  name: 'a coin scores its placement value, not its type default',
  level: 'level1',
  run(test) {
    const coin = test.entity('coin-2')
    test.at('player-0', coin.x, coin.y + 1.2)
    test.simulate(1)
    test.is(test.state.score, 50, 'score used the override')
    test.is(test.count('coin'), 2, 'the coin was destroyed on contact')
  }
}
\`\`\`

\`\`\`
node bin/engine.mjs tests.run              # all of them
node bin/engine.mjs tests.run coin-pickup  # one
node bin/engine.mjs tests.results          # last verdicts, without running
npm test                                   # a separate suite: the CLI itself
\`\`\`

Passing tests report one line each; only failures report detail. Each test
reloads its level first, so tests cannot affect each other, and a simulated
world refuses to save, so a test run cannot damage a level file.

\`test\` is the whole API:

| | |
|---|---|
| \`test.simulate(sec)\` | advance the fixed clock |
| \`test.hold(action, sec)\` / \`test.tap(action)\` | press a real key bound to a named action |
| \`test.entity(id)\` \`test.count(type)\` \`test.exists(id)\` \`test.state\` | read |
| \`test.at(id,x,y)\` \`test.set(id,k,v)\` \`test.spawn()\` \`test.destroy(id)\` | arrange |
| \`test.is(got,want,message)\` \`test.near(got,want,tol,message)\` \`test.ok(cond,message)\` | assert |
| \`test.note(message)\` | record something without asserting |

All assertions run — a failure does not stop the test — so one run reports
every problem rather than the first one.

### Typical loop

\`\`\`
node bin/engine.mjs snapshot            # what is here
<edit project/types/coin.js>            # ordinary file edit
node bin/engine.mjs check               # is it valid and deterministic
node bin/engine.mjs tests.run           # did I break anything
node bin/engine.mjs simulate 2          # or check something not yet a test
node bin/engine.mjs errors              # if not, why
\`\`\`

## Writing files while it runs

Write a type, a test or a level with your ordinary file tools and the running
editor picks it up. No page reload, no restart, and the world stays where it
was — same entities, same positions, same selection.

| You write | What happens |
|---|---|
| a **new** \`types/*.js\` | registered and immediately spawnable |
| an **edit** to a type | live entities move onto the new definition; per-placement overrides survive |
| a type with a **syntax error** | reported in \`errors\`, and entities keep running the last version that parsed |
| a \`behaviours/*.js\` | every entity that attached it moves onto the new file, and running state in its bag survives |
| a \`levels/*.json\` | reloaded if it is the level you have open |
| a \`tests/*.js\` | runnable at once, no reload |
| an \`assets/*.png\` | texture re-fetched |
| a \`plugins/*.js\` | full page reload — a plugin owns DOM and listeners |

\`log\` records every swap, so "did my write take?" is answerable:

\`\`\`
node bin/engine.mjs log 10        # e.g.  hot  types/coin.js → 3 entities
\`\`\`

One exception: **deleting** a project file reloads the page. Vite does not
consult plugins on unlink, so it reaches for a reload before the engine sees
it. Editing, adding and breaking a file are all handled in place.

Plugins are still fixed when the page loads, so a new \`project/plugins/*.js\`
needs the reload it triggers anyway.

## Authoring from the editor, or from here

\`\`\`
node bin/engine.mjs run new.file '["type","enemy"]'         # writes project/types/enemy.js
node bin/engine.mjs run new.file '["behaviour","chase"]'    # writes project/behaviours/chase.js
node bin/engine.mjs run place.at '["coin", 4, 2]'           # puts one in the level
node bin/engine.mjs run plugins.list                        # every plugin, and what it gives
node bin/engine.mjs run plugins.enable '["Physics 2D", false]'
\`\`\`

In the editor: \`+\` in the Project panel creates a type, behaviour, level, test
or plugin. Drag a **type** out of that panel into the viewport to place one, or
a **behaviour** onto an entity to attach it. The \`PLUGINS\` toolbar button
opens a browser with a switch for each.

Disabled plugins are recorded in \`project/game.json\`, which also holds
\`title\` and \`startLevel\` — the level the editor opens.

## Extending the editor

Everything except the kernel is a plugin, including every built-in panel.
Drop a file in \`project/plugins/\` — no manifest, no registration.

\`\`\`js
export default {
  name: 'Sprite Browser',
  panels: [{
    id: 'sprites', title: 'Sprites', dock: 'right',
    render: (ui, context) => ui.grid({
      items: context.assets('image'),
      cell: a => ui.thumb(a, { label: a.name }),
      onPick: a => context.select(a)
    })
  }]
}
\`\`\`

Contribution points: \`panels\` \`tools\` \`commands\` \`fields\` \`importers\`
\`systems\` \`menus\` — and there are only these seven. To listen for an event,
call \`context.bus.on\` inside \`onLoad\`; \`on\` is not a contribution point.

Plugins never write markup — compose from \`ui.*\` (\`stack row section text
label value meta glyph field button toggle slider pick search list grid thumb
preview\`). Read \`plugins/builtin/\` for working examples of every point.
A plugin that throws is disabled by name; it cannot take the editor down.

**Name a plugin the way you would say it out loud**, in capitalised words:
\`Inspector Panel\`, \`Physics 2D\`, \`Terminal Bridge\`. That name is what the
plugin browser lists, what \`plugins.enable\` takes, and what an error is
reported against — one name doing all three jobs.

## Changing the engine itself

**The engine is not a fixed platform. It is part of the work, and you may
change it.**

If a game needs something the runtime does not have — tilemaps, parenting,
particles, a pause, a raycast, a second collider shape — the right move is
usually to *add it to the engine*, not to work around it in game code. A
workaround buried in one type file helps one game once. The same thing added as
a plugin helps every game after it, and the next agent finds it in the index
instead of reinventing it.

\`\`\`
engine/            the kernel — 10 files, ~2,000 lines, all of it readable
plugins/builtin/   everything else, including every panel and physics itself
\`\`\`

Where to put a change, in order of preference:

1. **A new plugin** in \`plugins/builtin/\`. No registration, no manifest — the
   loader globs the folder. Physics is a plugin. The inspector is a plugin.
   Almost anything you want is a plugin.
2. **An addition to an existing plugin** — a new command, a new system.
3. **The kernel**, and only when the kernel is the thing in your way: a new
   field on the entity, a new contribution point, a change to the loop.

Read \`ARCHITECTURE.md\` first. It says what each kernel module owns and, more
usefully, what it is *not allowed to know about*.

### What not to break

These are load-bearing. Changing one is a real decision, not a detail.

- **Files on disk are the truth.** No in-memory document, no save button, no
  format only the editor understands.
- **Determinism.** Game code cannot reach the wall clock, \`Math.random\` or
  \`setTimeout\`. \`simulate()\` repeating exactly is what lets you verify a
  change without a human looking at a screen.
- **Four hooks, and a flat entity.** Behaviours compose; they never query each
  other.
- **Plugins never write markup.** Compose from \`ui.*\`. If a panel needs
  something \`ui\` cannot express, add the primitive to \`engine/ui.js\` rather
  than reaching for raw DOM.
- **Spelled-out names**: \`properties\`, \`context\`, \`entity\`, \`seconds\`.
- **Silence is the enemy.** Anything that fails must say so, by name, in
  \`errors\`. A blank viewport with an empty error log is the worst thing this
  engine can hand you.

### After you change it

\`\`\`
node bin/engine.mjs check      # project still valid and deterministic
node bin/engine.mjs tests.run  # the game's own tests
npm test                       # the engine's own suite — run this whenever you touch engine/ or plugins/
\`\`\`

Then update \`ARCHITECTURE.md\` and \`README.md\`. This file regenerates itself
from \`vite.config.js\`; those two do not, and a doc that lies is worse than no
doc at all.

One thing to expect while you work: editing anything under \`engine/\` or
\`plugins/\` **reloads the page**, because a plugin owns DOM and listeners. Only
\`project/\` files swap in place. So an engine change costs you the world state
you were inspecting — batch your engine edits rather than making them one at a
time.

## Painpoints — you are the judge of what this cost

**You are the only witness to your own friction, and the answer is worthless a
day later.** Nobody else can see that finding a call site took six file reads,
that an error sent you to the wrong machine, or that one missing verb burned
twenty thousand tokens. So write it down while it stings.

\`\`\`
node bin/engine.mjs pain "resolve() reported the collision side inverted, so grounded was never true" \\
     --kind engine --where plugins/builtin/physics-2d.js \\
     --cost 18000 --reads 6 --fix "a test that asserts grounded after landing"

node bin/engine.mjs pain.list
node bin/engine.mjs pain.resolve p3 "added world.hook — and it caught a call site I had missed"
\`\`\`

### Record the cost, not just the annoyance

\`--cost\` is your rough estimate of the **tokens this burned** — to discover
it, to work around it, or to fix it. \`--reads\` is how many files you had to
open before you understood.

This is the field that matters most. A painpoint that cost 20,000 tokens
outranks six that cost 500 each, and no amount of describing how annoying
something felt will tell anyone that. \`pain.list\` sorts by cost and sums it
by kind, so the output is a build queue rather than a diary.

**Guess.** An order of magnitude is worth enormously more than nothing — 500,
5,000, 50,000. An unpriced painpoint sorts *last*, never as a zero, so leaving
it off does not quietly mark it free.

\`--kind\` is one of **engine** (the runtime or the entity model), **cli** (the
verbs here — gathering context, checking your work), **docs** (this file lied,
or did not say), **editor** (the panels).

This needs no dev server and no editor. Friction is worst exactly when nothing
is running, so recording it never depends on anything working. It is one append
to \`painpoints.jsonl\` and you are back to what you were doing.

**Record it, then try to fix it.** If the fix is cheap — a CLI verb, a clearer
error, a line in this file — do it in the same round and resolve the painpoint.
If it is not cheap, leave it open; the next round starts with the list.

Worth recording, all real examples from this engine's own history:

- something failed silently, so you found it by reading rather than by error
- a thing you needed took more than two file reads to find
- you wrote a throwaway shell command because no verb did it
- you had to guess a shape, because nothing declared it
- this file told you something that turned out to be wrong
- something worked but you could not tell whether it had
- you re-derived a fact that the index could have answered in one call

**Do not** record taste ("I would have named this differently") or the game's
own bugs. Painpoints are about the engine getting in the way of building the
game.

At the end of a run, \`pain.list\` is the report: what this cost, where, and
what is still open.
`

export default defineConfig({
  plugins: [
    // bridge first: api() answers 404 for any unclaimed /api/ path, so anything
    // sharing that prefix has to register ahead of it.
    bridge(),
    api(),
    { name: 'engine-agent-doc', configureServer: () => writeAgentDoc() }
  ],
  // ENGINE_NO_OPEN keeps a headless or CI run from launching a visible browser.
  server: { port: 5180, open: !process.env.ENGINE_NO_OPEN }
})
