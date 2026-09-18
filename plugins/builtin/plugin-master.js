/**
 * Plugin Master — the rules for creating and editing plugins.
 *
 * The rules live in the sidecar guide, which declares `match: plugins/**
 * project/plugins/**`, so any plugin task carries them.
 *
 * It also measures and describes. Everything here is a plugin, and an agent pays
 * for every line it reads: a plugin nobody can open cheaply is one nobody will
 * edit correctly. `plugin.sizes` says which files have grown past the point
 * where finding one part of them costs more than the change is worth.
 * `plugin.facts` reads a plugin's syntax tree and answers with its interface and
 * a description derived from the code, so no author keeps a second copy of the
 * same facts in step by hand.
 *
 * Reading source needs node, so the browser answers with the command instead —
 * the same shape `tools.make` uses in Agent Tools. The browser needs no parser:
 * it holds every definition already, and `describe.js` words the same line from
 * whichever of the two it has.
 */
import { makeSourceReader } from './plugin-master/source-facts.js'
import { summaryOf } from './plugin-master/describe.js'

/** Past this, split it. Roughly twice the median builtin, so it flags the tail. */
const BIG = 400

/**
 * Past this, a guide moves its detail into `<stem>.agent/` and keeps only the
 * interface.
 *
 * Measured in characters of the body, not lines: a table packs several times
 * the text of a bullet into one line, so a line count ranks a dense guide as
 * small. 3000 characters is about 750 tokens, and a skill file is the whole
 * body — every agent that opens it pays for detail its task may not need.
 */
const GUIDE_BIG = 3000

const info = () => ({
  measures: 'lines of each plugin, characters of each guide, in plugins/builtin and <project>/plugins',
  big: BIG,
  guideBig: GUIDE_BIG,
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

/** A guide without its frontmatter. The body is what a skill and a packet carry. */
const guideBody = guide => guide.replace(/^---[\s\S]*?^---\s*/m, '').trim()

async function gameWords(root, directory, join, readFile) {
  try {
    const game = JSON.parse(await readFile(join(root, directory, 'game.json'), 'utf8'))
    return String(game.title || '').toLowerCase().split(/[^a-z0-9]+/i).filter(word => word.length >= 4)
  } catch { return [] }
}

/** The parser, made once: loading the grammar costs more than parsing one plugin. */
let reader = null
const sourceReader = async () => (reader ??= await makeSourceReader())

/**
 * Every plugin file of this checkout and its project, with source, guide and facts.
 *
 * One walk for both commands: `plugin.sizes` and `plugin.facts` ask different
 * questions of the same three reads, and reading every file twice would be the
 * slow half of `check`.
 */
async function pluginSources(directory) {
  const { readdir, readFile } = await import('node:fs/promises')
  const { join, dirname } = await import('node:path')
  const { fileURLToPath } = await import('node:url')

  const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
  const parser = await sourceReader()
  const out = []
  for (const place of ['plugins/builtin', `${directory}/plugins`]) {
    const full = join(root, place)
    for (const name of (await readdir(full).catch(() => [])).sort()) {
      if (!name.endsWith('.js')) continue
      const stem = name.slice(0, -3)
      const source = await readFile(join(full, name), 'utf8').catch(() => '')
      const guide = await readFile(join(full, `${stem}.agent.md`), 'utf8').catch(() => '')
      out.push({
        plugin: `${place}/${name}`,
        stem,
        builtin: place === 'plugins/builtin',
        source,
        guide,
        facts: await parser.facts(name, source)
      })
    }
  }
  return out
}

/** Measure every plugin and guide against the two limits. */
async function measure(directory) {
  const { readFile } = await import('node:fs/promises')
  const { join, dirname } = await import('node:path')
  const { fileURLToPath } = await import('node:url')

  const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
  const words = await gameWords(root, directory, join, readFile)
  return (await pluginSources(directory)).map(entry => ({
    plugin: entry.plugin,
    builtin: entry.builtin,
    lines: entry.source.split('\n').length,
    guide: entry.guide ? entry.guide.split('\n').length : null,
    // The syntax tree, not a pattern: `category` may sit on the same line as
    // `name`, which an anchored pattern reads as no category at all.
    category: entry.facts?.category ?? null,
    // A comment may name the game — explaining why something is shaped the way
    // it is often has to. Code that names it is the smell.
    names: entry.builtin ? gameNouns(entry.source, words) : []
  }))
}

/**
 * Every text a skill is generated from, measured on its own.
 *
 * Walked by guide rather than by plugin, because a guide need not have a plugin
 * file beside it: See Frames documents part of See, and Kimodo documents an
 * external tool. Measuring through the plugin list would skip exactly those.
 *
 * `agents/skills/` is included: those are hand-written skills the manifest
 * registers, and an agent pays for their body on the same terms.
 */
async function measureGuides(directory) {
  const { readdir, readFile } = await import('node:fs/promises')
  const { join, dirname } = await import('node:path')
  const { fileURLToPath } = await import('node:url')

  const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
  const out = []
  for (const place of ['plugins/builtin', `${directory}/plugins`]) {
    const full = join(root, place)
    for (const name of (await readdir(full).catch(() => [])).sort()) {
      if (!name.endsWith('.agent.md')) continue
      const text = await readFile(join(full, name), 'utf8').catch(() => '')
      out.push({ guide: `${place}/${name}`, characters: guideBody(text).length })
    }
  }
  for (const name of (await readdir(join(root, 'agents/skills'), { withFileTypes: true }).catch(() => []))) {
    if (!name.isDirectory()) continue
    const file = `agents/skills/${name.name}/SKILL.md`
    const text = await readFile(join(root, file), 'utf8').catch(() => null)
    if (text !== null) out.push({ guide: file, characters: guideBody(text).length })
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
      // A guide past the limit is paid by every agent that opens its skill, whether
      // or not the task needs the detail. Its overflow belongs in `<stem>.agent/`.
      const guidesOver = (await measureGuides(context.editor.projectDirectory))
        .filter(entry => entry.characters > GUIDE_BIG)
        .sort((first, second) => second.characters - first.characters)
      // The Plugin Browser groups by category, and one that declares none is
      // listed under "uncategorised" — read by a person as a plugin nobody
      // could place rather than as a missing field.
      const uncategorised = all.filter(entry => entry.builtin && !entry.category).map(entry => entry.plugin)
      // A builtin naming the game is a capability written inside one game.
      const branded = all.filter(entry => entry.names.length)
        .map(entry => ({ plugin: entry.plugin, at: entry.names }))
      return {
        big: BIG,
        guideBig: GUIDE_BIG,
        counted: all.length,
        // A guide is how an agent uses a plugin without reading it, so a plugin
        // without one costs its whole length to understand at all.
        unguided,
        uncategorised,
        over: over.map(entry => ({ plugin: entry.plugin, lines: entry.lines })),
        guidesOver,
        branded,
        ok: over.length === 0 && unguided.length === 0 && branded.length === 0 &&
          uncategorised.length === 0 && guidesOver.length === 0
      }
    }
  }, {
    id: 'plugin.facts',
    label: 'Describe a plugin from its source, and list every derived description',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: { plugin: { type: 'string', description: 'one plugin name; omit for every plugin' } }
    },
    run: async (context, options = {}) => {
      if (typeof process === 'undefined' || !process.versions?.node) {
        return { ...info(), why: 'reading source needs node — use --headless or the terminal' }
      }
      const all = await pluginSources(context.editor.projectDirectory)
      const named = typeof options?.plugin === 'string' && options.plugin ? options.plugin : null

      if (named === null) {
        return {
          counted: all.length,
          // `described` says which plugins carry a sentence of their own. Every
          // other one is answered by the derived line, so no surface shows a
          // blank and nothing has to be worded twice.
          plugins: all.map(entry => ({
            plugin: entry.plugin,
            name: entry.facts?.name ?? null,
            category: entry.facts?.category ?? null,
            // The authored sentence travels with the list, so one call answers
            // both which plugins wrote their own and what they wrote.
            about: entry.facts?.about ?? null,
            described: entry.facts?.about ? 'declared' : 'derived',
            description: summaryOf(entry.facts ?? {})
          }))
        }
      }

      const one = all.filter(entry => entry.stem === named || entry.plugin.endsWith(`/${named}.js`))
      if (!one.length) return { error: `no plugin named "${named}"`, counted: all.length }
      return one.map(entry => {
        const description = summaryOf(entry.facts ?? {})
        const declared = entry.facts?.about ?? null
        return {
          ...entry.facts,
          plugin: entry.plugin,
          description,
          // Ready to paste when an author wants the authored slot filled: the
          // words are the code's own answer, not a second opinion about it.
          aboutLine: declared ? null : `about: '${description.replaceAll("'", "\\'")}'`
        }
      })
    }
  }]
}
