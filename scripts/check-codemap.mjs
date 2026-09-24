/**
 * Fail when the kernel's imports leave the kernel, read from the Codemap.
 *
 * The kernel is every file under `engine/` except the tooling named in
 * `kernel-trellis.yaml`. Tooling depends on the kernel, never the other way,
 * and the kernel imports nothing above `engine/`. A file Codemap cannot parse
 * fails too, because its imports are then unknown.
 *
 * Dynamic `import()` is not in the map; `kernel-trellis.yaml` bounds those.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** The tooling files `kernel-trellis.yaml` excludes from the kernel. */
function excludedTooling(checkout) {
  const yaml = fs.readFileSync(path.join(checkout, 'scripts', 'kernel-trellis.yaml'), 'utf8')
  return new Set([...yaml.matchAll(/^ {4}- (\S+)$/gm)].map(match => match[1]))
}

/** Whether an import names a file by path rather than a package. */
const isPathImport = source => source.startsWith('.') || source.startsWith('/')

/** The problems in one kernel file's imports, as `check` problem records. */
function importProblems(fileMap, tooling) {
  const file = `engine/${fileMap.file}`
  if (fileMap.parseErrors) return [{ file, why: 'Codemap cannot parse this file, so its imports are unknown' }]
  return fileMap.imports
    .filter(record => isPathImport(record.source))
    .filter(record => !record.resolved || tooling.has(record.resolved))
    .map(record => ({
      file,
      why: record.resolved
        ? `line ${record.line} imports the tooling file engine/${record.resolved}; the kernel never imports tooling`
        : `line ${record.line} imports ${record.source}, outside engine/; the kernel imports only itself and packages`
    }))
}

/**
 * Every kernel import that leaves the kernel, as `{ file, why }` records.
 * An empty list means the boundary holds. `kernelDirectory` is
 * `<checkout>/engine` unless a test maps another directory.
 */
export async function codemapProblems(checkout, kernelDirectory = path.join(checkout, 'engine')) {
  const pluginRoot = pathToFileURL(path.join(checkout, 'plugins', 'builtin') + path.sep)
  const { makeSourceReader } = await import(new URL('plugin-master/source-facts.js', pluginRoot))
  const { buildCodemap } = await import(new URL('codemap/scan.js', pluginRoot))
  const codemap = await buildCodemap(kernelDirectory, await makeSourceReader())
  const tooling = excludedTooling(checkout)
  return codemap.files
    .filter(fileMap => !tooling.has(fileMap.file))
    .flatMap(fileMap => importProblems(fileMap, tooling))
}

/** Print the problems and exit 1 when there are any. */
async function main() {
  const checkout = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
  const problems = await codemapProblems(checkout)
  console.log(`kernel import boundary (Codemap): ${problems.length ? 'BROKEN' : 'ok'}`)
  for (const problem of problems) console.error(`  ${problem.file}: ${problem.why}`)
  if (problems.length) process.exit(1)
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main()
