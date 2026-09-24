/**
 * Check that the core tests catch real breaks in the kernel.
 *
 * For each kernel file, make one small break at a time — flip a comparison,
 * swap `&&` for `||`, drop a `!`, turn `true` into `false` — and run the areas
 * that call the file (from `test/core/areas.generated.json`). A break no test
 * fails on is a line no test checks. A test that never fails on any break
 * checks nothing this run could see.
 *
 * It works in a detached git worktree at HEAD, so it never changes this
 * checkout, and it compares every run against that worktree's own clean run,
 * so a test that already fails there is not counted as a catch.
 *
 * Usage: node scripts/test-mutants.mjs [--file engine/x.js] [--area name] [--per-file 5] [--workers 3]
 * Writes agent-runs/test-mutants/report.json and prints a summary.
 */
import { execFile, execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { readAreaMap } from './test-areas.mjs'

/** One break per operator: what it becomes. */
const OPERATOR_SWAPS = {
  '<': '<=',
  '<=': '<',
  '>': '>=',
  '>=': '>',
  '===': '!==',
  '!==': '===',
  '==': '!=',
  '!=': '==',
  '&&': '||',
  '||': '&&',
  '+': '-',
  '-': '+'
}

/** A run that takes longer than this is a caught break: the code hangs. */
const RUN_TIMEOUT_MS = 120_000

/** One break record: where it is, the text it replaces, and what it says. */
const mutant = (file, source, start, end, replacement) => ({
  file,
  start,
  end,
  replacement,
  line: source.slice(0, start).split('\n').length,
  change: `${source.slice(start, end)} -> ${replacement}`
})

/** Every tree-sitter node under `node`, depth first. */
function* nodesIn(node) {
  yield node
  for (const child of node.children) yield* nodesIn(child)
}

/** The breaks one node allows: none, or one record. */
function breaksFor(file, source, node) {
  if (node.type === 'binary_expression') {
    const operator = node.childForFieldName('operator')
    const swap = OPERATOR_SWAPS[operator?.type]
    return swap ? [mutant(file, source, operator.startIndex, operator.endIndex, swap)] : []
  }
  if (node.type === 'unary_expression' && node.childForFieldName('operator')?.type === '!') {
    return [mutant(file, source, node.startIndex, node.childForFieldName('argument').startIndex, '')]
  }
  if (node.type === 'true' || node.type === 'false') {
    return [mutant(file, source, node.startIndex, node.endIndex, node.type === 'true' ? 'false' : 'true')]
  }
  return []
}

/** Every break in one file, in source order, read with the engine's tree-sitter reader. */
async function breaksInFile(reader, checkout, file) {
  const source = fs.readFileSync(path.join(checkout, file), 'utf8')
  const breaks = await reader.withTree(file, source, tree =>
    [...nodesIn(tree.rootNode)].flatMap(node => breaksFor(file, source, node))
  )
  return (breaks ?? []).sort((first, second) => first.start - second.start)
}

/** `count` breaks spread evenly through the list, so a sample covers the whole file. */
function spreadSample(breaks, count) {
  if (breaks.length <= count) return breaks
  return [...Array(count).keys()].map(index => breaks[Math.floor(((index + 0.5) * breaks.length) / count)])
}

/** Run test files in a worktree; resolves to failing test names, whether it timed out, and how long it took. */
function runTests(worktree, testFiles) {
  const started = Date.now()
  return new Promise(resolve => {
    execFile(
      process.execPath,
      ['--test', ...testFiles],
      { cwd: worktree, maxBuffer: 1 << 26, timeout: RUN_TIMEOUT_MS },
      (error, stdout) => {
        const timedOut = Boolean(error?.killed)
        const names = [...stdout.matchAll(/^✖ (.+?) \(\d[\d.]*m?s\)$/gm)].map(match => match[1])
        resolve({ timedOut, failed: new Set(names), milliseconds: Date.now() - started })
      }
    )
  })
}

/**
 * Apply one break in a worktree and run its areas, cheapest first, until one
 * catches it. Puts the file back before it resolves.
 */
async function runBreak(worktree, change, areaOrder, baselines) {
  const target = path.join(worktree, change.file)
  const original = fs.readFileSync(target, 'utf8')
  fs.writeFileSync(target, original.slice(0, change.start) + change.replacement + original.slice(change.end))
  try {
    for (const area of areaOrder) {
      const result = await runTests(worktree, baselines.get(area).testFiles)
      const caughtBy = [...result.failed].filter(name => !baselines.get(area).failed.has(name))
      if (result.timedOut || caughtBy.length)
        return { ...change, caught: true, caughtIn: area, caughtBy, timedOut: result.timedOut }
    }
    return { ...change, caught: false, caughtIn: null, caughtBy: [], timedOut: false }
  } finally {
    fs.writeFileSync(target, original)
  }
}

/**
 * A detached worktree at HEAD, with this checkout's `test/` copied over it,
 * so tests written since the last commit are measured against the committed
 * kernel. Reused and reset when it is already there.
 */
function prepareWorktree(checkout, index) {
  const worktree = path.join(checkout, '.agent-worktrees', `test-mutants-${index}`)
  if (!fs.existsSync(worktree))
    execFileSync('git', ['worktree', 'add', '--quiet', '--detach', worktree, 'HEAD'], { cwd: checkout })
  execFileSync('git', ['checkout', '--quiet', '--detach', '--force', 'HEAD'], { cwd: worktree })
  execFileSync('git', ['clean', '--quiet', '--force', '-d', '--', 'test'], { cwd: worktree })
  fs.cpSync(path.join(checkout, 'test'), path.join(worktree, 'test'), { recursive: true })
  return worktree
}

/** The command-line options, with defaults. */
function readOptions(argv) {
  const value = flag => {
    const index = argv.indexOf(flag)
    return index < 0 ? null : argv[index + 1]
  }
  return {
    file: value('--file'),
    area: value('--area'),
    perFile: Number(value('--per-file') || 5),
    workers: Number(value('--workers') || 3)
  }
}

/** Each area's clean run in the worktree: its test files, what already fails, and its cost. */
async function measureBaselines(worktree, map, areaNames) {
  const baselines = new Map()
  for (const area of areaNames) {
    const run = await runTests(worktree, map.areas[area])
    baselines.set(area, { testFiles: map.areas[area], failed: run.failed, milliseconds: run.milliseconds })
  }
  return baselines
}

/** Every break to run: a sample from each kernel file, with its areas cheapest first. */
async function planBreaks(worktree, map, options, baselines) {
  const reader = await sourceReader(worktree)
  const planned = []
  for (const file of Object.keys(map.kernelFiles).filter(name => !options.file || name === options.file)) {
    const areas = map.kernelFiles[file].filter(area => !options.area || area === options.area)
    if (!areas.length) continue
    const areaOrder = [...areas].sort(
      (first, second) => baselines.get(first).milliseconds - baselines.get(second).milliseconds
    )
    const sample = spreadSample(await breaksInFile(reader, worktree, file), options.perFile)
    planned.push(...sample.map(change => ({ change, areaOrder })))
  }
  return planned
}

/** The engine's tree-sitter reader, the one Codemap and Plugin Master use. */
async function sourceReader(checkout) {
  const sourceFacts = pathToFileURL(path.join(checkout, 'plugins', 'builtin', 'plugin-master', 'source-facts.js'))
  const { makeSourceReader } = await import(sourceFacts.href)
  return makeSourceReader()
}

/** Run the breaks over the worktrees, one break per worktree at a time. */
async function runAll(worktrees, planned, baselines) {
  const results = []
  let next = 0
  const worker = async worktree => {
    while (next < planned.length) {
      const { change, areaOrder } = planned[next++]
      const result = { ...(await runBreak(worktree, change, areaOrder, baselines)), areas: areaOrder }
      results.push(result)
      console.log(
        `${result.caught ? `caught by ${result.caughtIn}` : 'MISSED'}  ${result.file}:${result.line}  ${result.change}`
      )
    }
  }
  await Promise.all(worktrees.map(worker))
  return results.sort((first, second) => first.file.localeCompare(second.file) || first.start - second.start)
}

/** The report record: what was missed, which area catches first, and which tests caught anything. */
function buildReport(options, results, baselines) {
  const caughtIn = {}
  for (const result of results) if (result.caught) caughtIn[result.caughtIn] = (caughtIn[result.caughtIn] || 0) + 1
  const catchesByTest = {}
  for (const result of results) for (const name of result.caughtBy) catchesByTest[name] = (catchesByTest[name] || 0) + 1
  return {
    options,
    breaks: results.length,
    caught: results.filter(result => result.caught).length,
    caughtFirstByArea: caughtIn,
    areaSeconds: Object.fromEntries([...baselines].map(([area, baseline]) => [area, baseline.milliseconds / 1000])),
    missed: results.filter(result => !result.caught).map(({ file, line, change }) => ({ file, line, change })),
    catchesByTest
  }
}

/** Run the plan, write the report, and print what it found. */
async function main() {
  const checkout = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
  const map = readAreaMap(checkout)
  if (!map) throw new Error('no area map: run npm run test:areas first')
  const options = readOptions(process.argv.slice(2))
  const worktrees = [...Array(options.workers).keys()].map(index => prepareWorktree(checkout, index))
  const areaNames = Object.keys(map.areas).filter(area => !options.area || area === options.area)
  const baselines = await measureBaselines(worktrees[0], map, areaNames)
  const planned = await planBreaks(worktrees[0], map, options, baselines)
  console.log(`${planned.length} breaks over ${worktrees.length} worktrees`)
  const report = buildReport(options, await runAll(worktrees, planned, baselines), baselines)
  const reportDirectory = path.join(checkout, 'agent-runs', 'test-mutants')
  fs.mkdirSync(reportDirectory, { recursive: true })
  fs.writeFileSync(path.join(reportDirectory, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(`\ncaught ${report.caught} of ${report.breaks} (${Math.round((100 * report.caught) / report.breaks)}%)`)
  console.log('first catch by area:', report.caughtFirstByArea)
  console.log('report: agent-runs/test-mutants/report.json')
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main()
