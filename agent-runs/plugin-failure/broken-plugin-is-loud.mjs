/**
 * Proof: a plugin file that throws on import is impossible to miss.
 *
 * Breaks `plugins/builtin/see.js` on purpose, starts headless worlds against
 * it, and prints what an agent would actually read — the default snapshot with
 * no options passed, the plugin list, and the text of the "no command" reply
 * for one of See's verbs. The file is restored in a `finally`, so a crash here
 * never leaves a broken plugin on disk.
 *
 * Each phase runs as its own process. Node caches a module by URL for the life
 * of a process, including one that failed to parse, so a healthy boot and a
 * broken boot cannot share one.
 *
 *   node agent-runs/plugin-failure/broken-plugin-is-loud.mjs
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = fileURLToPath(import.meta.url)
const ROOT = path.resolve(path.dirname(HERE), '../..')
const PROJECT = 'kitten-survivors'
const VICTIM = path.join(ROOT, 'plugins/builtin/see.js')
const engineModule = name => import(pathToFileURL(path.join(ROOT, 'engine', name)).href)

// ---------------------------------------------------------------- worlds

/** The shipped headless runner, exactly as `bin/engine.mjs --headless` starts it. */
async function shippedWorld() {
  const { startWorldInNode } = await engineModule('start-world-node.mjs')
  return (await startWorldInNode({ root: ROOT, project: PROJECT })).engine
}

/**
 * The same world with the two wiring lines in place: the finder reports a file
 * it could not import to the loader, and the log is made before the plugins
 * load so it hears the failure as it happens.
 *
 * Both lines belong to `engine/start-world.js`, which this lane may not edit,
 * so they are stood in for here — the finder is handed a stand-in that keeps
 * what it is told until the real loader appears, and the read surface is built
 * over the early log by hand. Every surface below is the real one: same loader,
 * same bus, same plugins off disk.
 */
async function wiredWorld() {
  const { startWorld } = await engineModule('start-world.js')
  const { makeInspect, makeLog } = await engineModule('inspect.js')
  const { makeFiles } = await engineModule('files.js')
  const { onDisk } = await engineModule('start-world-node.mjs')
  const { importPlugin } = await engineModule('plugin-import.js')

  const projectDirectory = path.join(ROOT, PROJECT)
  const places = [
    { directory: path.join(ROOT, 'plugins/builtin'), builtin: true },
    { directory: path.join(projectDirectory, 'plugins'), builtin: false }
  ]

  const waiting = []
  const standInForTheLoader = { failedImport: (...told) => waiting.push(told) }

  const findPlugins = async (loader = standInForTheLoader) => {
    const found = []
    for (const { directory, builtin } of places) {
      let names = []
      try { names = fs.readdirSync(directory) } catch { continue }
      for (const name of names.sort()) {
        if (!name.endsWith('.js')) continue
        const file = path.join(directory, name)
        const definition = await importPlugin({
          file: path.relative(ROOT, file),
          load: () => import(pathToFileURL(file).href),
          loader,
          builtin
        })
        if (definition) found.push({ definition, builtin })
      }
    }
    return found
  }

  let version = 0
  const importProjectFile = async file =>
    (await import(pathToFileURL(path.join(projectDirectory, file)).href + `?hot=${++version}`)).default || {}

  // openFiles runs immediately after the loader is made and long before the
  // plugins load, which is where `makeLog(bus)` belongs in the wired world.
  let log = null
  const world = await startWorld({
    openFiles: bus => { log = makeLog(bus); return makeFiles(bus, onDisk(projectDirectory)) },
    loadPlugins: findPlugins,
    importProjectFile,
    projectDirectory: PROJECT,
    attachScreen: async context => {
      for (const told of waiting) context.loader.failedImport(...told)
    }
  })

  const { loader, loop, files, bus, editor, view } = world
  return makeInspect({ world: world.world, loader, loop, files, bus, editor, view, log })
}

// ---------------------------------------------------------------- reading

/** What an agent reads, in the order it reads it. */
function report(engine, command) {
  const snapshot = engine.snapshot()
  console.log('--- snapshot(), no options ---')
  console.log(JSON.stringify({
    counts: snapshot.counts,
    pluginsFailed: snapshot.pluginsFailed,
    errors: snapshot.errors
  }, null, 2))

  console.log('--- snapshot({ plugins: true }).plugins, entries that did not load ---')
  console.log(JSON.stringify(
    engine.snapshot({ plugins: true }).plugins.filter(p => p.error || p.loaded === false), null, 2))

  console.log(`--- engine.run(${JSON.stringify(command)}) ---`)
  try {
    engine.run(command)
    console.log('(no error — the command ran)')
  } catch (e) {
    console.log(e.message)
  }

  console.log('--- loader.failures() ---')
  console.log(JSON.stringify(engine.loader.failures(), null, 2))
}

const PHASES = {
  async typo() { report(await shippedWorld(), 'see.captrue') },
  async shipped() { report(await shippedWorld(), 'see.capture') },
  async wired() { report(await wiredWorld(), 'see.capture') }
}

// ---------------------------------------------------------------- run

const phase = process.argv[2]
if (phase) {
  await PHASES[phase]()
  process.exit(0)
}

const child = name => {
  console.log(`\n================ ${name} ================`)
  try {
    console.log(execFileSync(process.execPath, [HERE, name], { cwd: ROOT, encoding: 'utf8' }).trimEnd())
  } catch (e) {
    console.log((e.stdout || '') + (e.stderr || ''))
  }
}

const original = fs.readFileSync(VICTIM, 'utf8')
try {
  console.log('Everything loads: the reply to a command that is simply not there.')
  child('typo')

  console.log('\nBreaking plugins/builtin/see.js with a stray brace…')
  fs.writeFileSync(VICTIM, original + '\n}\n', 'utf8')

  console.log('\nThe shipped headless runner (engine/start-world.js not yet wired):')
  child('shipped')

  console.log('\nThe same world with the finder and the log wired to the loader:')
  child('wired')
} finally {
  fs.writeFileSync(VICTIM, original, 'utf8')
  console.log(`\nrestored ${path.relative(ROOT, VICTIM)} — identical: ${fs.readFileSync(VICTIM, 'utf8') === original}`)
}
