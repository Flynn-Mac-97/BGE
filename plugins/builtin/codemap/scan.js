/**
 * A structural map of every JavaScript file under one directory.
 *
 * Filesystem access is confined to `listSourceFiles` and `buildCodemap`. Import
 * resolution and the summary are pure over the file maps, so a test can join
 * maps it wrote by hand and check the graph without touching disk.
 */
import { languageOf } from '../plugin-master/source-facts.js'
import { extractFile } from './extract.js'

/**
 * Directory names that hold no project source.
 *
 * Dependencies, version-control metadata, generated output and agent scratch
 * all contain JavaScript that is not this project's structure, and mapping them
 * buries the files that are.
 */
const IGNORED_DIRECTORIES = new Set([
  'node_modules',
  '.git',
  '.pi',
  'dist',
  'build',
  'coverage',
  '.cache',
  'agent-runs',
  '.agent-worktrees',
  '.engine',
  'archive',
  'release',
  '.browsers',
  '.dream-projects',
  '.tmp-agent-tests',
  '.codemap',
  '.agents'
])

/** Paths join with forward slashes, so a map built on Windows reads on POSIX. */
const toPosixPath = value => String(value).replaceAll('\\', '/')

/** Join two posix path parts and collapse `.` and `..`, without node:path. */
function posixJoin(base, source) {
  const parts = `${base}/${source}`.split('/')
  const out = []
  for (const part of parts) {
    if (part === '' || part === '.') continue
    if (part === '..') out.pop()
    else out.push(part)
  }
  return out.join('/')
}

/** The directory part of a posix path, or '' at the top. */
const posixDirname = file => (file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '')

/**
 * Recursively list the JavaScript files under `root`, skipping ignored
 * directories. `fs` and `path` are passed in so this runs only in node and so a
 * caller can substitute them.
 */
async function listSourceFiles(fs, path, root, ignored) {
  const found = []
  async function walk(directory) {
    const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      const full = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        if (!ignored.has(entry.name)) await walk(full)
      } else if (entry.isFile() && languageOf(entry.name) !== null) {
        found.push(full)
      }
    }
  }
  await walk(root)
  return found.sort()
}

/** Each file key without its extension, so an extensionless import still resolves. */
function extensionlessIndex(fileMaps) {
  const index = new Map()
  for (const map of fileMaps) {
    const bare = map.file.replace(/\.[^.]+$/, '')
    if (!index.has(bare)) index.set(bare, map.file)
  }
  return index
}

/**
 * The file key a relative specifier resolves to, or null.
 *
 * A specifier that names a package, an absolute path or a URL is not this
 * project's edge. A bare specifier is probed as a file key and as a directory
 * `index`, with its extension and without.
 */
function resolveImport(fromFile, source, byPath, byBare) {
  if (!source?.startsWith('.')) return null
  const base = posixJoin(posixDirname(fromFile), source)
  for (const candidate of [base, `${base}/index`]) {
    // A file importing itself is not a dependency.
    if (candidate === fromFile) continue
    if (byPath.has(candidate)) return candidate
    if (byBare.has(candidate)) return byBare.get(candidate)
  }
  return null
}

/**
 * Annotate every import and re-export with the file key it resolves to, and
 * derive each file's sorted `dependsOn`. Pure: returns new maps, so the input
 * is not changed and an unresolved specifier keeps its original shape.
 */
function resolveDependencyEdges(fileMaps) {
  const byPath = new Map(fileMaps.map(map => [map.file, map]))
  const byBare = extensionlessIndex(fileMaps)

  return fileMaps.map(map => {
    const dependsOn = new Set()
    const resolve = specifier => {
      const resolved = resolveImport(map.file, specifier, byPath, byBare)
      if (resolved) dependsOn.add(resolved)
      return resolved
    }

    const imports = map.imports.map(record => {
      const resolved = resolve(record.source)
      return resolved ? { ...record, resolved } : record
    })
    // `export ... from './x.js'` reaches another module; without this a barrel
    // file appears disconnected from everything it re-exports.
    const exports = map.exports.map(record => {
      const resolved = record.from === undefined ? undefined : resolve(record.from)
      return resolved ? { ...record, resolved } : record
    })

    return { ...map, imports, exports, dependsOn: [...dependsOn].sort() }
  })
}

/** Count files, symbols, imports, exports and files with parse errors. Pure. */
function summarize(fileMaps) {
  const total = key => fileMaps.reduce((sum, file) => sum + file[key].length, 0)
  return {
    files: fileMaps.length,
    symbols: total('symbols'),
    imports: total('imports'),
    exports: total('exports'),
    parseErrors: fileMaps.filter(file => file.parseErrors).length
  }
}

/**
 * Build a codemap for every JavaScript file under `root`.
 *
 * `reader` is the plugin-master source reader, passed in so the grammar is
 * loaded once per process and the parse path stays the engine's one.
 *
 * @param {string} root The directory to map.
 * @param {{ withTree: (file: string, source: string, read: Function) => Promise<any> }} reader
 * @returns {Promise<object>} `{ root, generatedAt, files, stats }`.
 */
export async function buildCodemap(root, reader, { ignored = IGNORED_DIRECTORIES } = {}) {
  const fs = await import('node:fs/promises')
  const path = await import('node:path')
  const absoluteRoot = path.resolve(root)
  const filePaths = await listSourceFiles(fs, path, absoluteRoot, ignored)

  const fileMaps = []
  for (const filePath of filePaths) {
    const source = await fs.readFile(filePath, 'utf8')
    const file = toPosixPath(path.relative(absoluteRoot, filePath))
    fileMaps.push(await reader.withTree(file, source, tree => extractFile(tree, file)))
  }

  return {
    root: absoluteRoot,
    // Wall-clock is an effect, so it lives in the shell rather than a renderer.
    generatedAt: new Date().toISOString(),
    files: resolveDependencyEdges(fileMaps),
    stats: summarize(fileMaps)
  }
}
