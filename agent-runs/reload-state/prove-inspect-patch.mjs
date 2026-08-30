/**
 * Prove the `engine/inspect.js` patch in the report, without applying it.
 *
 * `engine/inspect.js` is not this lane's to edit, so the change is written down
 * for the coordinator to apply by hand. A patch nobody has run is a guess, so
 * this applies it to a copy, imports the copy, and drives the result: the note
 * reaches `snapshot()` once, reaches a command reply once, and is never seen
 * twice.
 *
 *   node agent-runs/reload-state/prove-inspect-patch.mjs
 *
 * Every replacement below must match exactly once. If one does not, the patch in
 * the report has drifted from the file and this fails loudly rather than
 * quietly proving something else.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../..')

const line = text => process.stdout.write(`${text}\n`)

/** The patch, as three exact replacements. This is the report's text, run. */
const PATCH = [
  {
    what: 'makeInspect takes the note',
    from: `export function makeInspect({ world, loader, loop, files, bus, editor, view }) {
  const log = []`,
    to: `export function makeInspect({ world, loader, loop, files, bus, editor, view, reload }) {
  const log = []

  /**
   * A fact the kernel learned while booting, said once and then not again.
   *
   * A page reload rebuilds the world, and a rebuilt world nobody announced is
   * one an agent goes on reading as though it were the world it left. The
   * kernel knows; this is how it gets to say so. One field, named for what
   * happened — \`worldWasRestored\` or \`worldWasReset\` — and absent whenever there
   * is nothing to say, so it can never become noise.
   */
  const note = out => {
    const said = reload?.()
    if (said) out[said.key] = said.sentence
    return out
  }

  const plainReply = value =>
    !!value && typeof value === 'object' && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)`
  },
  {
    what: 'snapshot carries it',
    from: `      if (options.commands) out.commands = loader.contrib.commands.map(c => c.id)
      return out`,
    to: `      if (options.commands) out.commands = loader.contrib.commands.map(c => c.id)
      return note(out)`
  },
  {
    what: 'a command reply carries it',
    from: `      if (command.toolbar !== false && loader.contrib.menus.includes(command)) editor.context.redraw()
      return out`,
    to: `      if (command.toolbar !== false && loader.contrib.menus.includes(command)) editor.context.redraw()
      // A reply is where an agent is certainly looking, so a waiting note rides
      // on one — but only on a reply with room for it. A command that answers
      // with a number or a list answers with exactly that, and the note waits
      // for the next question shaped to carry it.
      return plainReply(out) ? note({ ...out }) : out`
  }
]

const source = await fs.readFile(path.join(ROOT, 'engine/inspect.js'), 'utf8')
let patched = source
for (const { what, from, to } of PATCH) {
  const hits = patched.split(from).length - 1
  if (hits !== 1) {
    line(`FAILED: "${what}" matched ${hits} times, not once — the patch has drifted from the file`)
    process.exit(1)
  }
  patched = patched.replace(from, to)
  line(`applied  ${what}`)
}

const copy = path.join(HERE, 'inspect-patched.js')
await fs.writeFile(copy, patched, 'utf8')
const { makeInspect } = await import(pathToFileURL(copy).href + `?v=${Date.now()}`)

// The smallest world the reading surface will accept. Nothing here is the real
// engine; what is being proven is the reply, not the world behind it.
const notice = {
  key: 'worldWasRestored',
  sentence: 'a hot reload of plugins/builtin/see.js reloaded the page at 11:28:09 UTC; the world was put back to LOOK at, not to run on.'
}
let waiting = notice
const engine = makeInspect({
  world: { types: new Map([['rat', {}]]), entities: [], behaviours: new Map(), all: () => [] },
  loader: { plugins: new Map(), contrib: { commands: [{ id: 'a.plain', run: () => ({ ok: true }) }, { id: 'a.number', run: () => 7 }], menus: [] } },
  loop: { running: false, time: 5, paused: false, holds: [], random: { seed: 1 } },
  files: { pending: 0 },
  bus: { on: () => {} },
  editor: { levelName: 'meadow', selection: new Set(), context: { redraw: () => {} } },
  view: { x: 0, y: 0, zoom: 32, mode: 'ortho' },
  reload: () => { const said = waiting; waiting = null; return said }
})

const said = out => (out?.worldWasRestored ? 'the notice' : 'nothing')
line('')
line(`snapshot 1        carries ${said(engine.snapshot())}`)
line(`snapshot 2        carries ${said(engine.snapshot())}`)

waiting = notice
line(`run("a.plain")    carries ${said(engine.run('a.plain'))}`)
line(`run("a.plain")    carries ${said(engine.run('a.plain'))}`)

waiting = notice
const number = engine.run('a.number')
line(`run("a.number")   answered ${JSON.stringify(number)} — shape untouched, the note still waits`)
line(`snapshot next     carries ${said(engine.snapshot())}`)

waiting = null
const clean = engine.snapshot()
line(`with nothing to say, snapshot has no reload field: ${!('worldWasRestored' in clean) && !('worldWasReset' in clean)}`)
line(`and simulate's snapshot is the same object shape:  ${'counts' in clean}`)
