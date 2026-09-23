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
 * `sloppinessIndex` is printed but not budgeted. At least 20 of its points are
 * the audit's penalty for the dynamic imports hot reload and plugin discovery
 * need, so it does not move when the kernel's shape improves. See the comment in
 * `structure-budget.json`.
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const checkout = path.join(here, '..')
const auditScript = path.join(checkout, '.pi', 'skills', 'trellis-audit', 'scripts', 'trellis.sh')
const kernelConfig = path.join(here, 'kernel-trellis.yaml')
const budget = JSON.parse(fs.readFileSync(path.join(here, 'structure-budget.json'), 'utf8'))

/** The budgeted fields and the audit metric each one reads. */
const BUDGET_METRICS = {
  erodedCount: 'erosion.eroded-count.production',
  duplicationGroups: 'duplication.groups.production',
  importCycleGroups: 'import-cycle.groups'
}

// A missing budget reads as undefined and every number passes it, so refuse it.
for (const field of Object.keys(BUDGET_METRICS)) {
  if (typeof budget[field] !== 'number') {
    console.error(`check-structure: structure-budget.json has no number for ${field}`)
    process.exit(1)
  }
}

const audit = spawnSync('bash', [auditScript, 'audit', 'engine', '--config', kernelConfig, '--json'], {
  cwd: checkout,
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024
})
if (audit.status !== 0) {
  process.stderr.write(audit.stderr || '')
  console.error(`check-structure: the audit failed with status ${audit.status}`)
  process.exit(1)
}

const report = JSON.parse(audit.stdout)

console.log('kernel structure budget (engine/** minus the peripheral tooling in kernel-trellis.yaml)')
let overBudget = false
for (const [field, metricId] of Object.entries(BUDGET_METRICS)) {
  const measured = report.metrics[metricId].value
  const over = measured > budget[field]
  overBudget ||= over
  console.log(`  ${over ? 'OVER' : 'ok  '} ${field}: ${measured} (budget ${budget[field]})`)
}
console.log(`  info sloppinessIndex: ${report.score.index} (not budgeted: the unresolved-dynamic-import floor)`)
console.log(`  info completeness: ${report.completeness}`)
console.log(
  `  info kernel closure: ${report.sourceCoverage.production.files} files, ` +
    `${report.sourceCoverage.excluded.files} peripheral files excluded`
)
if (overBudget) {
  console.error('check-structure: the kernel is past its structure budget')
  process.exit(1)
}
