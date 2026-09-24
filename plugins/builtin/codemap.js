/**
 * Codemap — a structural map of the engine's own JavaScript, read with
 * tree-sitter.
 *
 * An agent that needs to know how the engine is shaped should ask for a map
 * instead of reading whole files. This plugin answers one JSON view and four
 * terminal views, all from one parse per file: `codemap.scan` (the whole map),
 * `codemap.file` (one file), `codemap.system` (modules as boxes),
 * `codemap.deps` (the dependency tree) and `codemap.md` (a markdown report).
 *
 * Reading source needs node, so a browser answers with the command instead —
 * the same shape Plugin Master uses. The parse itself is the plugin-master
 * source reader, so the grammar, runtime and extension rules are the engine's
 * one path rather than a second copy.
 */
import { languageOf, makeSourceReader } from './plugin-master/source-facts.js'
import { buildCodemap } from './codemap/scan.js'
import { extractFile } from './codemap/extract.js'
import { formatMarkdown } from './codemap/format.js'
import { formatSystem } from './codemap/system.js'
import { formatDeps } from './codemap/deps.js'

/** The checkout root, from this file's location: plugins/builtin/codemap.js. */
const CHECKOUT = new URL('../..', import.meta.url)

/** What this plugin answers, so a refusal still says what the command would have measured. */
const info = () => ({
  measures: "symbols, imports, exports and dependency edges of this checkout's JavaScript",
  run: 'node bin/engine.mjs --headless run codemap.scan'
})

/** A browser cannot read source; the reply says so instead of looking like an empty map. */
const NODE_ONLY = { ...info(), why: 'reading source needs node — use --headless or the terminal' }

/** Whether this process can read source. */
const inNode = () => typeof process !== 'undefined' && Boolean(process.versions?.node)

/** The parser, made once: loading the grammar costs more than reading one file. */
let reader = null
const sourceReader = async () => (reader ??= await makeSourceReader())

/**
 * The directory to map: the checkout root, or a named directory inside it.
 *
 * A path outside the checkout is refused: this tool answers for the engine's
 * own JavaScript, and reading another tree is not its job.
 */
function directoryInside(path, checkoutRoot, directory) {
  const resolved = path.resolve(checkoutRoot, directory || '')
  const relative = path.relative(checkoutRoot, resolved)
  // '' is the checkout itself; '..' and an absolute path are above it.
  if (path.isAbsolute(relative) || relative === '..' || relative.startsWith('..' + path.sep)) return null
  return resolved
}

/** The absolute checkout root, resolved only when a command runs. */
async function checkoutRoot() {
  const { fileURLToPath } = await import('node:url')
  return fileURLToPath(CHECKOUT)
}

/** Build the map for one view, or an error a caller can read. */
async function loadCodemap(options = {}) {
  const path = await import('node:path')
  const root = directoryInside(path, await checkoutRoot(), options.directory)
  if (root === null) return { error: `"${options.directory}" is outside this checkout` }
  return { codemap: await buildCodemap(root, await sourceReader()) }
}

/** Wrap one file's map in the same shape `buildCodemap` returns. */
function singleFileCodemap(map, root) {
  return {
    root,
    generatedAt: new Date().toISOString(),
    files: [{ dependsOn: [], ...map }],
    stats: {
      files: 1,
      symbols: map.symbols.length,
      imports: map.imports.length,
      exports: map.exports.length,
      parseErrors: map.parseErrors ? 1 : 0
    }
  }
}

/** The structure of one named file inside the checkout, or an error. */
async function loadFileCodemap(options = {}) {
  if (typeof options.file !== 'string' || !options.file) return { error: 'codemap.file needs a "file" argument' }
  const fs = await import('node:fs/promises')
  const path = await import('node:path')
  const root = await checkoutRoot()
  const target = directoryInside(path, root, options.file)
  if (target === null) return { error: `"${options.file}" is outside this checkout` }
  if (languageOf(target) === null) return { error: `not JavaScript: ${options.file}` }
  const source = await fs.readFile(target, 'utf8').catch(() => null)
  if (source === null) return { error: `no such file: ${options.file}` }
  const file = path.relative(root, target).replaceAll('\\', '/')
  const map = await (await sourceReader()).withTree(file, source, tree => extractFile(tree, file))
  return { codemap: singleFileCodemap(map, root) }
}

/** The `directory` argument every view accepts. */
const DIRECTORY_PROPERTY = {
  directory: { type: 'string', description: 'a directory inside the checkout; the checkout root when absent' }
}

/** Run a view, turning a browser or a bad path into a readable reply. */
async function answer(load, render = codemap => codemap) {
  if (!inNode()) return NODE_ONLY
  const { codemap, error } = await load()
  return error ? { error } : render(codemap)
}

/** A text view's reply: the rendered map, named so a caller can tell which view it asked for. */
const textView = (view, text) => ({ view, text })

export default {
  name: 'Codemap',
  category: 'agents',
  about: "A structural map of the engine's own JavaScript, read with tree-sitter.",

  commands: [
    {
      id: 'codemap.scan',
      label: 'Whole-project structure as JSON',
      inputSchema: { type: 'object', additionalProperties: false, properties: { ...DIRECTORY_PROPERTY } },
      run: (_context, options) => answer(() => loadCodemap(options))
    },
    {
      id: 'codemap.file',
      label: "One file's structure as JSON",
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['file'],
        properties: { file: { type: 'string', description: 'a JavaScript file inside the checkout' } }
      },
      run: (_context, options) => answer(() => loadFileCodemap(options))
    },
    {
      id: 'codemap.system',
      label: 'Modules as a system map',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ...DIRECTORY_PROPERTY,
          locals: { type: 'boolean', description: 'include function-local variables' }
        }
      },
      run: (_context, options) =>
        answer(() => loadCodemap(options), codemap =>
          textView('system', formatSystem(codemap, { includeLocals: options?.locals === true }))
        )
    },
    {
      id: 'codemap.deps',
      label: 'Module dependency tree',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ...DIRECTORY_PROPERTY,
          root: { type: 'string', description: 're-root the tree at this module, relative to the scanned directory' },
          depth: { type: 'number', minimum: 0, description: 'expand the tree this many levels; full when absent' },
          symbols: { type: 'boolean', description: "show each module's classes, functions and exported constants" },
          locals: { type: 'boolean', description: 'include function-local variables' }
        }
      },
      run: (_context, options) =>
        answer(() => loadCodemap(options), codemap =>
          textView(
            'deps',
            formatDeps(codemap, {
              includeLocals: options?.locals === true,
              includeSymbols: options?.symbols === true,
              maxDepth: Number.isInteger(options?.depth) && options.depth >= 0 ? options.depth : Infinity,
              focusModule: typeof options?.root === 'string' && options.root ? options.root : null
            })
          )
        )
    },
    {
      id: 'codemap.md',
      label: 'Structural markdown report',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ...DIRECTORY_PROPERTY,
          locals: { type: 'boolean', description: 'include function-local variables' }
        }
      },
      run: (_context, options) =>
        answer(() => loadCodemap(options), codemap =>
          textView('md', formatMarkdown(codemap, { includeLocals: options?.locals === true }))
        )
    }
  ]
}
