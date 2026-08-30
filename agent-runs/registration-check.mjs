/**
 * Prove `engine/agent-registration.mjs` against the real tree.
 *
 * `vite.config.js` and `bin/engine.mjs` are owned by another workflow right
 * now, so the module is called directly here instead. Run it from the checkout:
 *
 *   node agent-runs/registration-check.mjs            # project
 *   node agent-runs/registration-check.mjs kitten-survivors
 *
 * Read-only. The failure paths are proved on a built tree by
 * `agent-runs/registration-fixture.mjs`, because editing a real guide to make
 * one drift would race the workflow that owns `plugins/builtin/`.
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  generatedAgentFiles,
  generatedFileProblems,
  skillRegistrationProblems,
  agentRegistrationProblems
} from '../engine/agent-registration.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PROJECT = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'project'

const fatal = problems => problems.filter(problem => !problem.warning)

const report = problems => {
  for (const problem of problems) console.log(`  ${problem.warning ? 'warning' : 'FAIL   '}  ${problem.file}\n            ${problem.why}`)
  if (!problems.length) console.log('  none')
}

console.log(`root=${ROOT}\nproject=${PROJECT}\n`)

console.log('generated files this project should have:')
for (const file of await generatedAgentFiles(ROOT, PROJECT)) {
  console.log(`  ${file.path}  <- ${file.source}  (${file.text.length} chars)`)
}

console.log('\ngenerated file drift:')
const drift = await generatedFileProblems(ROOT, PROJECT)
report(drift)

console.log('\nregistration:')
const registration = await skillRegistrationProblems(ROOT, PROJECT)
report(registration)

const all = await agentRegistrationProblems(ROOT, PROJECT)
console.log(`\nregistration alone would exit ${fatal(all).length ? 1 : 0}  (${fatal(all).length} failures, ${all.length - fatal(all).length} warnings)`)

// The whole of the patched `check`, composed exactly as the replacement block
// in agent-runs/registration-apply.mjs composes it, run against the real tree.
const { buildIndex, problemsIn, pluginImportFailures, pluginProblems } = await import('../engine/project-index.mjs')
const projectPath = path.join(ROOT, PROJECT)
const failed = await pluginImportFailures(ROOT, projectPath)
const problems = [
  ...pluginProblems(failed),
  ...await agentRegistrationProblems(ROOT, path.basename(projectPath)),
  ...problemsIn(await buildIndex(projectPath))
]
console.log(`patched check: ${fatal(problems).length} failures, ${problems.length - fatal(problems).length} warnings, exit ${fatal(problems).length ? 1 : 0}`)
for (const problem of fatal(problems)) console.log(`  FAIL  ${problem.file}  ${problem.why}`)
