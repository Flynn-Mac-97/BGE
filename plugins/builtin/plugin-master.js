/**
 * Plugin Master — the rules for creating and editing plugins.
 *
 * The rules live in the sidecar guide, which declares `match: plugins/**
 * project/plugins/**`, so any plugin task carries them.
 *
 * It also measures. Everything here is a plugin, and an agent pays for every
 * line it reads: a plugin nobody can open cheaply is one nobody will edit
 * correctly. `plugin.sizes` says which files have grown past the point where
 * finding one part of them costs more than the change is worth. Reading source
 * needs node, so the browser answers with the command instead — the same shape
 * `tools.make` uses in Agent Tools.
 */

/** Past this, split it. Roughly twice the median builtin, so it flags the tail. */
const BIG = 400

const info = () => ({
  measures: 'lines of each plugin and its guide, in plugins/builtin and <project>/plugins',
  big: BIG,
  run: 'node bin/engine.mjs --headless run plugin.sizes'
})

async function measure() {
  const { readdir, readFile } = await import('node:fs/promises')
  const { join, dirname } = await import('node:path')
  const { fileURLToPath } = await import('node:url')

  const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
  const lines = async file => (await readFile(file, 'utf8').catch(() => '')).split('\n').length
  const out = []

  for (const place of ['plugins/builtin', 'project/plugins']) {
    const directory = join(root, place)
    for (const name of (await readdir(directory).catch(() => [])).sort()) {
      if (!name.endsWith('.js')) continue
      const stem = name.slice(0, -3)
      out.push({
        plugin: `${place}/${name}`,
        lines: await lines(join(directory, name)),
        guide: await lines(join(directory, `${stem}.agent.md`)) || null
      })
    }
  }
  return out
}

export default {
  name: 'Plugin Master',
  about: 'The rules for creating and editing plugins, and a measure of which have grown too big to read cheaply.',

  commands: [{
    id: 'plugin.sizes',
    label: 'Measure every plugin against the size rule',
    run: async () => {
      if (typeof process === 'undefined' || !process.versions?.node) {
        return { ...info(), why: 'reading source needs node — use --headless or the terminal' }
      }
      const all = await measure()
      const over = all.filter(entry => entry.lines > BIG).sort((a, b) => b.lines - a.lines)
      const unguided = all.filter(entry => !entry.guide).map(entry => entry.plugin)
      return {
        big: BIG,
        counted: all.length,
        // A guide is how an agent uses a plugin without reading it, so a plugin
        // without one costs its whole length to understand at all.
        unguided,
        over: over.map(entry => ({ plugin: entry.plugin, lines: entry.lines })),
        ok: over.length === 0 && unguided.length === 0
      }
    }
  }]
}
