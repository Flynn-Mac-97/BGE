/**
 * The kernel gate: formatting, lint, the Trellis structure budget and the
 * Codemap import boundary, run together.
 *
 * `node bin/engine.mjs check` and `npm run check` both call it, so the two
 * cannot disagree. Lint and format run through their `package.json` scripts,
 * which own the list of files each one covers.
 */
import { exec } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { structureReport } from './check-structure.mjs'
import { codemapProblems } from './check-codemap.mjs'

/** Color codes would stop the output being read, so they are turned off. */
const PLAIN_OUTPUT = { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' }

/** Run one `package.json` script; resolves to its exit status and output. */
function runScript(checkout, script) {
  const options = { cwd: checkout, env: PLAIN_OUTPUT, maxBuffer: 64 * 1024 * 1024 }
  return new Promise(resolve => {
    exec(`npm run -s ${script}`, options, (error, stdout, stderr) =>
      resolve({ status: error ? (error.code ?? 1) : 0, stdout, stderr })
    )
  })
}

/** A path from the checkout root, with forward slashes. */
const fromCheckout = (checkout, file) => path.relative(checkout, file).split(path.sep).join('/')

/** One problem per lint message, from ESLint's JSON report. */
async function lintProblems(checkout) {
  const run = await runScript(checkout, 'lint -- --format json')
  if (run.status === 0) return []
  let report
  try {
    report = JSON.parse(run.stdout)
  } catch {
    return [
      { file: 'eslint.config.mjs', why: `lint could not run: ${(run.stderr || run.stdout).trim().slice(0, 400)}` }
    ]
  }
  return report.flatMap(result =>
    result.messages.map(message => ({
      file: fromCheckout(checkout, result.filePath),
      why: `line ${message.line}: ${message.message} (${message.ruleId ?? 'parse'}) — agents/code-style.md`
    }))
  )
}

/** One problem per file Prettier would change. */
async function formatProblems(checkout) {
  const run = await runScript(checkout, 'format:check')
  if (run.status === 0) return []
  const files = [...`${run.stdout}\n${run.stderr}`.matchAll(/^\[warn\] (?!Code style issues)(.+)$/gm)]
  if (!files.length)
    return [{ file: 'prettier.config.mjs', why: `format check could not run: ${run.stderr.trim().slice(0, 400)}` }]
  return files.map(match => ({ file: match[1].trim(), why: 'not formatted; run npm run format' }))
}

/** The structure budget as problems: none, or one naming why it failed. */
async function structureProblems(checkout) {
  const { lines, failure } = await structureReport(checkout)
  if (!failure) return []
  return [{ file: 'scripts/structure-budget.json', why: `Trellis: ${failure}\n${lines.join('\n')}` }]
}

/**
 * Every kernel gate problem, as `{ file, why }` records like the rest of
 * `check`. An empty list means the kernel passes.
 */
export async function kernelGateProblems(checkout) {
  const groups = await Promise.all([
    formatProblems(checkout),
    lintProblems(checkout),
    structureProblems(checkout),
    codemapProblems(checkout)
  ])
  return groups.flat()
}

/** Print each problem and exit 1 when there are any. */
async function main() {
  const checkout = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
  const problems = await kernelGateProblems(checkout)
  for (const problem of problems) console.error(`${problem.file}: ${problem.why}`)
  console.log(
    `kernel gate: ${problems.length ? `${problems.length} problem(s)` : 'ok'} (format, lint, Trellis, Codemap)`
  )
  if (problems.length) process.exit(1)
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main()
