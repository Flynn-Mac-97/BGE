/**
 * Fail when the kernel's structure regresses past the committed budget.
 *
 * Audits the kernel closure — every file under engine/ except the peripheral
 * tooling listed in `kernel-trellis.yaml` — because the raw engine/** scope is
 * dominated by a tree the kernel never imports. Reads the budgeted numbers from
 * `structure-budget.json` and prints every budgeted metric either way, then the
 * non-budgeted ones as information. A budgeted number above its budget fails
 * the check; `importCycleGroups` at 0 fails on any new cycle.
 *
 * `sloppinessIndex` is printed but not budgeted. Its remaining points are the
 * audit's incomplete-graph floor, produced by the deliberate dynamic imports at
 * hot reload and plugin discovery, so it does not move when the kernel's shape
 * improves. `unresolvedImports` bounds that floor instead. See the comment in
 * `structure-budget.json`.
 *
 * Trellis runs in this process from `vendor/trellis`, so the check needs no
 * bun and nothing outside this repository.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** The budgeted fields and the audit metric each one reads. */
const BUDGET_METRICS = {
  erodedCount: 'erosion.eroded-count.production',
  duplicationGroups: 'duplication.groups.production',
  importCycleGroups: 'import-cycle.groups',
  unresolvedImports: 'graph.edges.unresolved'
}

/** The Trellis report for the kernel closure, from the vendored library. */
async function auditKernel(checkout) {
  const vendor = pathToFileURL(path.join(checkout, 'vendor', 'trellis') + path.sep)
  const { auditWorkspace } = await import(new URL('audit.mjs', vendor))
  const { loadAuditConfigFile } = await import(new URL('config.mjs', vendor))
  const loaded = await loadAuditConfigFile(path.join(checkout, 'scripts', 'kernel-trellis.yaml'))
  return auditWorkspace(path.join(checkout, 'engine'), { config: loaded.config ?? loaded })
}

/** One line per budgeted metric, and whether any is over its budget. */
function budgetLines(report, budget) {
  const lines = []
  let overBudget = false
  for (const [field, metricId] of Object.entries(BUDGET_METRICS)) {
    const measured = report.metrics[metricId].value
    const over = measured > budget[field]
    overBudget ||= over
    lines.push(`  ${over ? 'OVER' : 'ok  '} ${field}: ${measured} (budget ${budget[field]})`)
  }
  return { lines, overBudget }
}

/** The measured numbers that are printed but never fail the check. */
function infoLines(report) {
  const unresolved = report.metrics['graph.edges.unresolved'].value
  return [
    `  info sloppinessIndex: ${report.score.index} (not budgeted: ${unresolved} deliberate dynamic ` +
      `import(s) leave the graph incomplete; bounded by unresolvedImports)`,
    `  info completeness: ${report.completeness}`,
    `  info kernel closure: ${report.sourceCoverage.production.files} files, ` +
      `${report.sourceCoverage.excluded.files} peripheral files excluded`
  ]
}

/**
 * Audit the kernel against its budget. Resolves to `{ lines, failure }`:
 * the report to print, and a sentence saying why it failed, or `null`.
 */
export async function structureReport(checkout) {
  const budget = JSON.parse(fs.readFileSync(path.join(checkout, 'scripts', 'structure-budget.json'), 'utf8'))
  // A missing budget reads as undefined and every number passes it, so refuse it.
  const missing = Object.keys(BUDGET_METRICS).find(field => typeof budget[field] !== 'number')
  if (missing) return { lines: [], failure: `structure-budget.json has no number for ${missing}` }

  let report
  try {
    report = await auditKernel(checkout)
  } catch (error) {
    return { lines: [String(error?.stack || error)], failure: 'the Trellis audit could not run' }
  }
  const { lines, overBudget } = budgetLines(report, budget)
  return {
    lines: [
      'kernel structure budget (engine/** minus the peripheral tooling in kernel-trellis.yaml)',
      ...lines,
      ...infoLines(report)
    ],
    failure: overBudget ? 'the kernel is past its structure budget' : null
  }
}

/** Print the report and exit 1 when it failed. */
async function main() {
  const checkout = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
  const { lines, failure } = await structureReport(checkout)
  for (const line of lines) console.log(line)
  if (failure) {
    console.error(`check-structure: ${failure}`)
    process.exit(1)
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main()
