import { sourceHash, replaceSource } from './document-store.mjs'
import fs from 'node:fs/promises'
import path from 'node:path'

/** The one pattern of source files a scope will read. */
function sourcePattern(scope) {
  return scope === 'engine'
    ? /^(?:index\.html|engine\/.+\.(?:js|mjs|cjs|css)|plugins\/builtin\/.+\.(?:js|mjs|cjs))$/
    : /^(plugins|types|behaviours)\/.+\.(js|mjs|cjs)$/
}

/** Whether a path is plain and relative: no backslash, no climb and no empty part. */
function isCleanRelativePath(file) {
  if (file.includes('\\')) return false
  return file.split('/').every(part => part && part !== '..' && part !== '.')
}

/** Refuse anything a source read must not be asked for. */
function assertSourcePath(scope, file, allowed) {
  const scopes = ['engine', 'project']
  if (!scopes.includes(scope) || typeof file !== 'string' || !allowed.test(file) || !isCleanRelativePath(file)) {
    throw new Error('source path must name an engine, plugin, type or behaviour JavaScript file')
  }
}

/** Source inspection has no write path and cannot leave the selected source directories. */
export async function readSource(checkout, project, scope, file) {
  const allowed = sourcePattern(scope)
  assertSourcePath(scope, file, allowed)
  const root = await fs.realpath(scope === 'engine' ? checkout : project)
  const absolute = await fs.realpath(path.resolve(root, file))
  const relative = path.relative(root, absolute)
  if (relative.startsWith('..') || path.isAbsolute(relative) || !allowed.test(relative.replaceAll('\\', '/'))) {
    throw new Error('source path leaves its root')
  }
  const information = await fs.stat(absolute)
  if (!information.isFile() || information.size > 2_000_000) throw new Error('source file exceeds inspection limit')
  const text = await fs.readFile(absolute, 'utf8')
  return { scope, file, text, hash: sourceHash(text) }
}

/** The host supplies roots and labels; analysis consumes only the returned file data. */
export async function sourceCatalog(checkout, project = checkout, selection = 'core') {
  if (!['core','plugins','project','all'].includes(selection)) throw new Error('Unknown source selection')
  const files = [], errors = []
  let bytes = 0
  /** Read one candidate file into the catalog, counting bytes against the scan limit. */
  async function add(root, scope, file, group) {
    if (files.length >= 1200 || bytes > 20_000_000) throw new Error('Source scan exceeds 1200 files or 20 MB; scan a smaller scope')
    try { const result = await readSource(root, project, scope, file); bytes += result.text.length; files.push({ ...result, path:file, group }) }
    catch (error) { errors.push(`${scope}:${file}: ${error.message}`) }
  }
  /** Recurse one allowed source directory into the catalog. */
  async function walk(root, scope, directory, group) {
    const base = await fs.realpath(root)
    let entries
    try {
      const absolute = await fs.realpath(path.join(root, directory))
      const relative = path.relative(base, absolute)
      if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Scan root leaves its source directory')
      entries = await fs.readdir(absolute, { withFileTypes:true })
    } catch (error) { if (error.code !== 'ENOENT') errors.push(`${directory}: ${error.message}`); return }
    for (const entry of entries) {
      const file = directory + '/' + entry.name
      if (entry.isDirectory()) await walk(root, scope, file, group)
      else if (entry.isFile() && /\.(js|mjs|cjs|css)$/.test(entry.name)) await add(root,scope,file,group)
    }
  }
  if (selection === 'core' || selection === 'all') { await add(checkout,'engine','index.html','Engine Core'); await walk(checkout,'engine','engine','Engine Core') }
  if (selection === 'plugins' || selection === 'all') await walk(checkout,'engine','plugins/builtin','Built-in Plugins')
  if (selection === 'project' || selection === 'all') for (const directory of ['plugins','types','behaviours']) await walk(project,'project',directory,directory === 'plugins' ? 'Project Plugins' : 'Game Code')
  files.sort((left,right)=>(left.scope+left.file).localeCompare(right.scope+right.file))
  return { files, errors, selection }
}

/** Write one source file after re-reading it through the same path rules, under a hash check. */
export async function writeSource(checkout, project, scope, file, text, expectedHash) {
  if (!/\.(js|mjs|cjs)$/.test(file || '')) throw new Error('Source editing supports JavaScript files only')
  await readSource(checkout, project, scope, file)
  const root = await fs.realpath(scope === 'engine' ? checkout : project)
  const absolute = await fs.realpath(path.resolve(root,file))
  const relative = path.relative(root,absolute)
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Source path leaves its root')
  return replaceSource(absolute,text,expectedHash)
}
