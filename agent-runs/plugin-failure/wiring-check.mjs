/**
 * Check the two wiring edits this lane cannot ship, without shipping them.
 *
 * `engine/start-world.js` and `engine/start-world-node.mjs` belong to other
 * owners, so the lines that hand the loader to the plugin finder and the log to
 * the read surface are written out here, applied, exercised against a
 * deliberately broken plugin, and taken straight back off. Every file is
 * restored in a `finally` and the working tree is checked afterwards — this
 * script must leave nothing behind.
 *
 * Its output is the evidence that the replacements below can be applied
 * verbatim at merge.
 *
 *   node agent-runs/plugin-failure/wiring-check.mjs
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = fileURLToPath(import.meta.url)
const ROOT = path.resolve(path.dirname(HERE), '../..')
const PROJECT = 'kitten-survivors'
const VICTIM = path.join(ROOT, 'plugins/builtin/see.js')

/** file -> the exact text to find, and what replaces it. */
const EDITS = [
  ['engine/start-world.js',
    "import { makeInspect } from './inspect.js'",
    "import { makeInspect, makeLog } from './inspect.js'"],

  ['engine/start-world.js',
    '  /** async () => [{ definition, builtin }] — a glob in the browser, readdir in node. */',
    '  /**\n   * async (loader) => [{ definition, builtin }] — a glob in the browser, readdir\n   * in node. The loader is handed over because a file that throws on import has\n   * no plugin name, and the loader is the only place that failure can be kept.\n   */'],

  ['engine/start-world.js',
    '  const bus = makeBus()\n  const world = makeWorld(bus)',
    '  const bus = makeBus()\n  // Made before a plugin can fail. The read surface is built last, so a world\n  // that breaks while starting was the one world whose errors nothing was\n  // listening for — and it is the one an agent most needs described.\n  const log = makeLog(bus)\n  const world = makeWorld(bus)'],

  ['engine/start-world.js',
    '  const found = await loadPlugins()',
    '  const found = await loadPlugins(loader)'],

  ['engine/start-world.js',
    '  const engine = makeInspect({ world, loader, loop, files, bus, editor, view })',
    '  const engine = makeInspect({ world, loader, loop, files, bus, editor, view, log })'],

  ['engine/start-world-node.mjs',
    "import { buildIndex, walk } from './project-index.mjs'",
    "import { buildIndex, walk } from './project-index.mjs'\nimport { importPlugin } from './plugin-import.js'"],

  ['engine/start-world-node.mjs',
    ` * which is the same promise the index makes about types.
 */
async function findPlugins(root, projectDirectory) {`,
    ` * which is the same promise the index makes about types.
 *
 * The loader travels through to \`importPlugin\`, which is the one place that
 * decides what happens to a file that will not import. A path is named relative
 * to the checkout, so the same file reads the same here as in the browser.
 */
async function findPlugins(root, projectDirectory, loader) {`],

  ['engine/start-world-node.mjs',
    `      const file = path.join(directory, name)
      try {
        const definition = (await import(pathToFileURL(file).href)).default
        if (!definition) continue
        found.push({ definition, builtin })
      } catch (e) {
        console.error(\`[loader] \${file} failed to import\`, e)
      }`,
    `      const file = path.join(directory, name)
      const definition = await importPlugin({
        file: path.relative(root, file),
        load: () => import(pathToFileURL(file).href),
        loader,
        builtin
      })
      if (definition) found.push({ definition, builtin })`],

  ['engine/start-world-node.mjs',
    '    loadPlugins: () => findPlugins(checkout, projectDirectory),',
    '    loadPlugins: loader => findPlugins(checkout, projectDirectory, loader),']
]

// ---------------------------------------------------------------- the child

if (process.argv[2] === 'look') {
  const { startWorldInNode } = await import(pathToFileURL(path.join(ROOT, 'engine/start-world-node.mjs')).href)
  const { engine } = await startWorldInNode({ root: ROOT, project: PROJECT })
  const snapshot = engine.snapshot()
  console.log('--- snapshot(), no options ---')
  console.log(JSON.stringify({ pluginsFailed: snapshot.pluginsFailed, errors: snapshot.errors }, null, 2))
  console.log('--- snapshot({ plugins: true }).plugins, entries that did not load ---')
  console.log(JSON.stringify(
    engine.snapshot({ plugins: true }).plugins.filter(p => p.error || p.loaded === false), null, 2))
  console.log('--- engine.run("see.capture") ---')
  try { engine.run('see.capture') } catch (e) { console.log(e.message) }
  process.exit(0)
}

// ---------------------------------------------------------------- the run

const touched = [...new Set(EDITS.map(([file]) => file)), 'plugins/builtin/see.js']
const saved = new Map(touched.map(file => [file, fs.readFileSync(path.join(ROOT, file), 'utf8')]))

try {
  for (const [file, find, replace] of EDITS) {
    const full = path.join(ROOT, file)
    const before = fs.readFileSync(full, 'utf8')
    const hits = before.split(find).length - 1
    if (hits !== 1) throw new Error(`${file}: expected one match, found ${hits}\n${find}`)
    fs.writeFileSync(full, before.replace(find, replace), 'utf8')
  }
  console.log(`applied ${EDITS.length} edits across ${new Set(EDITS.map(e => e[0])).size} files, each matching exactly once`)

  // Wiring a failure path must not change a world where nothing failed.
  const healthy = execFileSync(process.execPath,
    ['bin/engine.mjs', '--headless', '--project', PROJECT, 'snapshot'], { cwd: ROOT, encoding: 'utf8' })
  console.log(`healthy world, everything loaded: pluginsFailed ${JSON.stringify(JSON.parse(healthy).pluginsFailed)}, ` +
    `errors ${JSON.parse(healthy).errors.length}, plugins ${JSON.parse(healthy).counts.plugins}`)
  // What `npm run test:offline` runs, invoked directly so no shell is involved.
  for (const suite of ['test/cli.offline.test.mjs', 'test/agent-workspace.test.mjs']) {
    const out = execFileSync(process.execPath, ['--test', suite], { cwd: ROOT, encoding: 'utf8' })
    console.log(`${suite} while wired: ${out.match(/ℹ (?:pass|fail) \d+/g).join(', ')}`)
  }
  console.log()

  fs.writeFileSync(path.join(ROOT, 'plugins/builtin/see.js'), saved.get('plugins/builtin/see.js') + '\n}\n', 'utf8')
  console.log('broke plugins/builtin/see.js with a stray brace\n')

  console.log('================ the shipped headless runner, wired ================')
  try {
    console.log(execFileSync(process.execPath, [HERE, 'look'], { cwd: ROOT, encoding: 'utf8' }).trimEnd())
  } catch (e) {
    console.log((e.stdout || '') + (e.stderr || ''))
  }
} finally {
  for (const [file, text] of saved) fs.writeFileSync(path.join(ROOT, file), text, 'utf8')
  const dirty = execFileSync('git', ['status', '--porcelain', '--', ...touched], { cwd: ROOT, encoding: 'utf8' }).trim()
  console.log(`\nrestored ${touched.length} files — working tree for them: ${dirty || 'clean'}`)
}
