/**
 * Fail when the kernel's structure regresses past the committed budget.
 *
 * Runs the same vendored Trellis audit `npm run audit` runs, reads the three
 * numbers in `structure-budget.json`, and prints each one either way so a run
 * says what it measured and not only that it passed. A number above its budget
 * fails the check; the audit's own policy already exits non-zero on a new
 * cycle, which is a break rather than a regression.
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const checkout = path.join(here, '..')
const auditScript = path.join(checkout, '.pi', 'skills', 'trellis-audit', 'scripts', 'trellis.sh')
const budget = JSON.parse(fs.readFileSync(path.join(here, 'structure-budget.json'), 'utf8'))

const audit = spawnSync('bash', [auditScript, 'audit', 'engine', '--json'], {
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
const measured = {
  sloppinessIndex: report.score.index,
  erodedCount: report.metrics['erosion.eroded-count.production'].value,
  duplicationGroups: report.metrics['duplication.groups.production'].value
}

console.log('kernel structure budget')
let overBudget = false
for (const name of Object.keys(budget)) {
  const over = measured[name] > budget[name]
  overBudget ||= over
  console.log(`  ${over ? 'OVER' : 'ok  '} ${name}: ${measured[name]} (budget ${budget[name]})`)
}
if (overBudget) {
  console.error('check-structure: the kernel is past its structure budget')
  process.exit(1)
}
