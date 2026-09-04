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

/**
 * Words from the game's own title, long enough to mean something.
 *
 * A builtin naming the game it happens to ship beside is a capability written
 * inside one game — the thing somebody has to find and rebrand before a second
 * game can use it. The title is the cheapest handle on "this game's nouns" that
 * does not need a list nobody maintains.
 */
async function gameWords(root, directory, join, readFile) {
  try {
    const game = JSON.parse(await readFile(join(root, directory, 'game.json'), 'utf8'))
    return String(game.title || '').toLowerCase().split(/[^a-z0-9]+/i).filter(word => word.length >= 4)
  } catch { return [] }
}

async function measure(directory) {
  const { readdir, readFile } = await import('node:fs/promises')
  const { join, dirname } = await import('node:path')
  const { fileURLToPath } = await import('node:url')

  const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
  const words = await gameWords(root, directory, join, readFile)
  const out = []

  for (const place of ['plugins/builtin', `${directory}/plugins`]) {
    const directory = join(root, place)
    for (const name of (await readdir(directory).catch(() => [])).sort()) {
      if (!name.endsWith('.js')) continue
      const stem = name.slice(0, -3)
      const source = await readFile(join(directory, name), 'utf8').catch(() => '')
      const guide = await readFile(join(directory, `${stem}.agent.md`), 'utf8').catch(() => '')
      out.push({
        plugin: `${place}/${name}`,
        builtin: place === 'plugins/builtin',
        lines: source.split('\n').length,
        guide: guide ? guide.split('\n').length : null,
        category: source.match(/^\s*category:\s*'([a-z-]+)'/m)?.[1] || null,
        // A comment may name the game — explaining why something is shaped the
        // way it is often has to. Code that names it is the smell.
        names: place === 'plugins/builtin' ? gameNouns(source, words) : []
      })
    }
  }
  return out
}

/** Lines of real code that mention one of the game's words, with the word. */
function gameNouns(source, words) {
  if (!words.length) return []
  const found = []
  source.split('\n').forEach((line, index) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return
    const lower = line.toLowerCase()
    for (const word of words) {
      if (lower.includes(word)) found.push({ line: index + 1, word })
    }
  })
  return found
}

export default {
  name: 'Plugin Master',
  category: 'engine',
  about: 'The rules for creating and editing plugins, and a measure of which have grown too big to read cheaply.',

  commands: [{
    id: 'plugin.sizes',
    label: 'Measure every plugin against the size rule',
    run: async context => {
      if (typeof process === 'undefined' || !process.versions?.node) {
        return { ...info(), why: 'reading source needs node — use --headless or the terminal' }
      }
      // The directory this world was opened on, not the default one. Measuring
      // one project's plugins while reading another project's title is the kind
      // of wrong answer that looks exactly like a right one.
      const all = await measure(context.editor.projectDirectory)
      const over = all.filter(entry => entry.lines > BIG).sort((a, b) => b.lines - a.lines)
      const unguided = all.filter(entry => !entry.guide).map(entry => entry.plugin)
      // The Plugin Browser groups by category, and one that declares none is
      // listed under "uncategorised" — read by a person as a plugin nobody
      // could place rather than as a missing field.
      const uncategorised = all.filter(entry => entry.builtin && !entry.category).map(entry => entry.plugin)
      // A builtin naming the game is a capability written inside one game.
      const branded = all.filter(entry => entry.names.length)
        .map(entry => ({ plugin: entry.plugin, at: entry.names }))
      return {
        big: BIG,
        counted: all.length,
        // A guide is how an agent uses a plugin without reading it, so a plugin
        // without one costs its whole length to understand at all.
        unguided,
        uncategorised,
        over: over.map(entry => ({ plugin: entry.plugin, lines: entry.lines })),
        branded,
        ok: over.length === 0 && unguided.length === 0 && branded.length === 0 && uncategorised.length === 0
      }
    }
  }]
}
