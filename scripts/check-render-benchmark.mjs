/**
 * Fail when the render benchmark regresses past the committed baseline.
 *
 * The benchmark itself only measures. This reads the last result and the
 * baseline, and fails when a kernel stage got slower than the baseline allows:
 * a scene's kernel share past its absolute tolerance, the entity sync at ten
 * thousand entities, or the executor's overhead at fifty passes.
 *
 * It needs a browser only through the result it reads, which is why it is not
 * part of `npm run check`. Run `npm run bench:render` first.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const checkout = path.join(here, '..')
const baselineFile = path.join(here, 'render-benchmark-baseline.json')
const resultFile = process.argv[2] || path.join(checkout, 'agent-runs', 'benchmark-results.json')

if (!fs.existsSync(baselineFile)) {
  console.error(`check-render-benchmark: no baseline at ${path.relative(checkout, baselineFile)}`)
  process.exit(1)
}
if (!fs.existsSync(resultFile)) {
  console.error(
    `check-render-benchmark: no result at ${path.relative(checkout, resultFile)} — run \`npm run bench:render\` first`
  )
  process.exit(1)
}

const baseline = JSON.parse(fs.readFileSync(baselineFile, 'utf8'))
const result = JSON.parse(fs.readFileSync(resultFile, 'utf8'))

if (result.problem) {
  console.error(`check-render-benchmark: the last benchmark failed — ${result.problem}`)
  process.exit(1)
}

const atEntity = count => (result.entityCurve || []).find(entry => entry.entities === count)
const atPass = count => (result.passCurve || []).find(entry => entry.probePasses === count)

/** One metric, its measured value, its ceiling, and whether it is over. */
function budget(what, measured, ceiling) {
  const over = !Number.isFinite(measured) || measured > ceiling
  return { what, measured, ceiling, over }
}

const checks = []
for (const [name, sceneBaseline] of Object.entries(baseline.budgets.scenes || {})) {
  const scene = (result.scenes || []).find(entry => entry.name === name)
  checks.push(budget(`${name}.kernelShare`, scene?.kernelShare, sceneBaseline.kernelShare + sceneBaseline.kernelShareTolerance))
}
const entity = baseline.budgets.entityCurve
checks.push(
  budget('entityCurve.syncMsAt10000', atEntity(10000)?.syncMs, entity.syncMsAt10000 * (1 + entity.tolerance) + entity.floorMs)
)
const passes = baseline.budgets.passCurve
checks.push(
  budget(
    'passCurve.executorOverheadMsAt50',
    atPass(50)?.executorOverheadMs,
    passes.executorOverheadMsAt50 * (1 + passes.tolerance) + passes.floorMs
  )
)

console.log('render benchmark budget (the baseline is scripts/render-benchmark-baseline.json)')
console.log(`  baseline measured ${baseline.measuredAt}`)
let overBudget = false
for (const check of checks) {
  overBudget ||= check.over
  const format = value => (Number.isFinite(value) ? value.toFixed(4) : String(value))
  console.log(`  ${check.over ? 'OVER' : 'ok  '} ${check.what}: ${format(check.measured)} (allowed ${format(check.ceiling)})`)
}

if (overBudget) {
  console.error('check-render-benchmark: the render kernel is past its budget')
  process.exit(1)
}
