/**
 * The core test areas, and which kernel files each one exercises.
 *
 * An area is one folder under `test/core/`. The map from kernel file to areas
 * is measured, not written: each area runs once under V8 coverage, and a file
 * belongs to an area when the area calls at least one of its functions.
 * Importing a file without calling it does not count, so a module that every
 * test loads is not in every area. Coverage passes to child processes, so a
 * test that drives the CLI measures the CLI's files too.
 *
 * `npm run test:areas` writes `test/core/areas.generated.json`. Run it again
 * after adding a test file or a kernel file; `node bin/engine.mjs test` runs
 * every area for a kernel file the map does not name.
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** The generated map, relative to the checkout. */
export const AREA_MAP_FILE = 'test/core/areas.generated.json'

/** A path from the checkout root, with forward slashes. */
const fromCheckout = (checkout, file) => path.relative(checkout, file).split(path.sep).join('/')

/** Every test file under one directory, sorted, as checkout-relative paths. */
function testFilesIn(checkout, directory) {
  return fs
    .readdirSync(path.join(checkout, directory), { recursive: true })
    .map(entry => String(entry).split(path.sep).join('/'))
    .filter(entry => entry.endsWith('.test.mjs'))
    .map(entry => `${directory}/${entry}`)
    .sort()
}

/** Each area under `test/core/` and its test files. */
export function coreAreas(checkout) {
  const root = path.join(checkout, 'test', 'core')
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => ({ name: entry.name, tests: testFilesIn(checkout, `test/core/${entry.name}`) }))
    .filter(area => area.tests.length)
}

/** Whether a coverage record says a function other than the module body ran. */
const calledAFunction = script =>
  script.functions.some(entry => entry.ranges[0].startOffset > 0 && entry.ranges[0].count > 0)

/** The kernel files one coverage directory shows as called, checkout-relative. */
function calledKernelFiles(checkout, coverageDirectory) {
  const called = new Set()
  for (const name of fs.readdirSync(coverageDirectory)) {
    const { result } = JSON.parse(fs.readFileSync(path.join(coverageDirectory, name), 'utf8'))
    for (const script of result) {
      if (!script.url.startsWith('file:')) continue
      const file = fromCheckout(checkout, fileURLToPath(script.url))
      if (file.startsWith('engine/') && calledAFunction(script)) called.add(file)
    }
  }
  return called
}

/** Run one area under coverage; returns the kernel files it called. */
function measureArea(checkout, area) {
  const coverageDirectory = fs.mkdtempSync(path.join(os.tmpdir(), `area-${area.name}-`))
  try {
    const run = spawnSync(process.execPath, ['--test', ...area.tests], {
      cwd: checkout,
      env: { ...process.env, NODE_V8_COVERAGE: coverageDirectory },
      encoding: 'utf8',
      maxBuffer: 1 << 26
    })
    if (run.status !== 0) throw new Error(`area ${area.name} fails before it is measured:\n${run.stdout.slice(-2000)}`)
    return calledKernelFiles(checkout, coverageDirectory)
  } finally {
    fs.rmSync(coverageDirectory, { recursive: true, force: true })
  }
}

/** Measure every area and build the map record written to `AREA_MAP_FILE`. */
export function buildAreaMap(checkout) {
  const areas = {}
  const kernelFiles = {}
  for (const area of coreAreas(checkout)) {
    areas[area.name] = area.tests
    for (const file of measureArea(checkout, area)) (kernelFiles[file] ??= []).push(area.name)
  }
  const sortedFiles = Object.fromEntries(
    Object.entries(kernelFiles).sort(([first], [second]) => first.localeCompare(second))
  )
  return { areas, kernelFiles: sortedFiles }
}

/**
 * The area map on disk, or `null` when it was never generated. Each area's
 * test files are read from disk now, so a new test file needs no new map.
 */
export function readAreaMap(checkout) {
  const file = path.join(checkout, AREA_MAP_FILE)
  if (!fs.existsSync(file)) return null
  const { kernelFiles } = JSON.parse(fs.readFileSync(file, 'utf8'))
  return { areas: Object.fromEntries(coreAreas(checkout).map(area => [area.name, area.tests])), kernelFiles }
}

/** The reasons one file selects areas, as `[area, why]` pairs. */
function reasonsFor(map, file) {
  const testArea = Object.keys(map.areas).find(area => map.areas[area].includes(file))
  if (testArea) return [[testArea, `${file} is one of its tests`]]
  if (!file.startsWith('engine/')) return []
  const areas = map.kernelFiles[file]
  if (areas) return areas.map(area => [area, `it calls ${file}`])
  return Object.keys(map.areas).map(area => [area, `${file} is not in the map yet, so every area runs`])
}

/**
 * The areas a set of changed files needs, as `{ area, why }` records in area
 * order. A file outside `engine/` and `test/core/` selects nothing.
 */
export function areasForFiles(map, files) {
  const reasons = new Map()
  for (const file of files) {
    for (const [area, why] of reasonsFor(map, file)) if (!reasons.has(area)) reasons.set(area, why)
  }
  return Object.keys(map.areas)
    .filter(area => reasons.has(area))
    .map(area => ({ area, why: reasons.get(area) }))
}

/** Files changed since the last commit, tracked and new, checkout-relative. */
export function changedFiles(checkout) {
  const git = args => spawnSync('git', args, { cwd: checkout, encoding: 'utf8' }).stdout.split('\n')
  const files = [...git(['diff', '--name-only', 'HEAD']), ...git(['ls-files', '--others', '--exclude-standard'])]
  return [...new Set(files.filter(Boolean))]
}

/** Write the measured map and print how many files each area covers. */
async function main() {
  const checkout = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
  const map = buildAreaMap(checkout)
  fs.writeFileSync(path.join(checkout, AREA_MAP_FILE), JSON.stringify(map, null, 2) + '\n')
  for (const name of Object.keys(map.areas)) {
    const count = Object.values(map.kernelFiles).filter(areas => areas.includes(name)).length
    console.log(`${name}: ${map.areas[name].length} test files, calls ${count} kernel files`)
  }
  console.log(`wrote ${AREA_MAP_FILE}: ${Object.keys(map.kernelFiles).length} kernel files mapped`)
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main()
