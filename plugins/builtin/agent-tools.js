/**
 * Agent Tools — the inspectable face of the tooling shelf in tools/.
 *
 * tools/ is where agent tooling lives: scripts written once, kept so nobody
 * regenerates them. This plugin lists the shelf and runs a wrapped tool on
 * demand. The generators need node's fs and zlib, so a tool runs headless —
 * in the browser it answers with the terminal command instead.
 *
 * The shelf is READ OFF DISK, not declared. It used to be a hand-kept array of
 * two demo scripts while eight real tools sat beside them, so an agent that
 * checked first was told the shelf was empty and rewrote a generator that
 * already existed. A hand-kept list goes stale; a directory read cannot.
 *
 * `tools/lib/` is listed separately and by export, because that is the half an
 * agent is meant to ADD to. A generator that needs wrapping noise should find
 * it, and a generator that invents something reusable should put it there.
 *
 * A game may still register a tool that lives elsewhere:
 *
 *   context.tools.register({
 *     name: 'my-textures', file: 'tools/make-my-textures.mjs',
 *     makes: 'my textures', run: 'node tools/make-my-textures.mjs'
 *   })
 */

/** Extra entries contributed at runtime, for anything not sitting in tools/. */
const REGISTERED = []

let runVersion = 0

const info = () => ({
  shelf: 'tools/ — one file per job, run with node',
  library: 'tools/lib/ — the machinery generators import, and the half to add to',
  run: 'node bin/engine.mjs --headless run tools.list'
})

/** The first sentence of a file's opening comment. What it is, in one line. */
function summarise(source) {
  const block = /^\s*(?:#![^\n]*\n)?\s*\/\*\*([\s\S]*?)\*\//.exec(source)
  if (!block) return null
  const text = block[1].split('\n').map(line => line.replace(/^\s*\*ce?/, '').replace(/^\s*\*\s?/, '').trim())
  const first = text.find(Boolean)
  if (!first) return null
  // Up to the first full stop, so a paragraph of reasoning does not come too.
  const stop = first.indexOf('. ')
  return (stop > 0 ? first.slice(0, stop + 1) : first).trim()
}

const exportsOf = source =>
  [...source.matchAll(/^export (?:async )?(?:function|const|let)\s+(\w+)/gm)].map(match => match[1])

async function readShelf() {
  const { readdir, readFile } = await import('node:fs/promises')
  const { join, dirname } = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const root = join(dirname(fileURLToPath(import.meta.url)), '../..')

  const look = async place => {
    const names = (await readdir(join(root, place)).catch(() => [])).sort()
    const out = []
    for (const name of names) {
      if (!/\.mjs$/.test(name)) continue
      const source = await readFile(join(root, place, name), 'utf8').catch(() => '')
      out.push({ place, name, source })
    }
    return out
  }

  const shelf = (await look('tools')).map(file => ({
    name: file.name.replace(/^make-|\.mjs$/g, ''),
    file: `tools/${file.name}`,
    // Detected, not declared: a tool is wrapped when it exports main().
    wrapped: /export\s+(?:async\s+)?function\s+main\b/.test(file.source),
    makes: summarise(file.source),
    run: `node tools/${file.name}`
  }))

  const library = (await look('tools/lib')).map(file => ({
    file: `tools/lib/${file.name}`,
    about: summarise(file.source),
    exports: exportsOf(file.source)
  }))

  // A game registering a tool that now turns up on disk anyway would list it
  // twice, and `tools.make` would pick whichever came first.
  const known = new Set(shelf.map(tool => tool.file))
  return { shelf: [...shelf, ...REGISTERED.filter(tool => !known.has(tool.file))], library }
}

export default {
  name: 'Agent Tools',
  about: 'The tooling shelf in tools/ — scripts written once, kept so nobody regenerates them, and the library they share.',
  inspect: () => [{ title: 'The shelf', rows: [['read with', 'tools.list']] }],

  onLoad(context) {
    context.tools = {
      list: readShelf,
      /** Add one tool that does not live in tools/ — a game's own generator elsewhere. */
      register(tool) {
        if (!tool?.name) throw new Error('tools.register needs a tool with a name')
        if (!REGISTERED.some(known => known.name === tool.name)) REGISTERED.push(tool)
        return REGISTERED
      }
    }
  },

  commands: [
    {
      id: 'tools.list',
      label: 'What is on the tooling shelf, and what the library already does',
      run: async () => {
        if (typeof process === 'undefined' || !process.versions?.node) {
          return { ...info(), why: 'reading tools/ needs node — use --headless or the terminal' }
        }
        const { shelf, library } = await readShelf()
        return {
          ...info(),
          shelfCount: shelf.length,
          tools: shelf,
          library,
          // A file nobody described costs its whole length to understand.
          undescribed: [...shelf.filter(tool => !tool.makes).map(tool => tool.file),
            ...library.filter(entry => !entry.about).map(entry => entry.file)]
        }
      }
    },
    {
      id: 'tools.make',
      label: 'Run a tool from the shelf',
      run: async (context, name) => {
        if (typeof process === 'undefined' || !process.versions?.node) {
          return { ...info(), why: 'generators need node fs and zlib — use --headless or the terminal' }
        }
        const { shelf } = await readShelf()
        const wanted = String(name ?? '')
        const tool = shelf.find(entry => entry.name === wanted || entry.file === wanted)
        if (!tool) return { error: `no tool "${name}". Try tools.list`, tools: shelf.map(entry => entry.name) }

        // Unwrapped tools are still one-command scripts; the shelf says how.
        if (!tool.wrapped) return { tool: tool.name, run: tool.run, why: 'runs as a script, not as an engine command' }

        const { main } = await import(/* @vite-ignore */ `../../${tool.file}?make=${++runVersion}`)
        await main()
        return { ok: true, tool: tool.name, makes: tool.makes }
      }
    }
  ]
}
