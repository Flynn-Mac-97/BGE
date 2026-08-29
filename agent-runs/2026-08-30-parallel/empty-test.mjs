/**
 * A test that asserts nothing must not be green.
 *
 * p23: runOne computed `ok` as `!error && checks.every(c => c.ok)`, and `every`
 * on an empty array is true — so a test disabled with an early return sat on
 * the board as a passing tick for its whole life. A dead test is worse than a
 * missing one, because it reads as coverage.
 *
 *   node agent-runs/2026-08-30-parallel/empty-test.mjs
 */
import { writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { startWorldInNode } from '../../engine/start-world-node.mjs'

const ROOT = 'Z:/Code/browser game engine'
const TESTS = join(ROOT, 'project/tests')

let failures = 0
const check = (ok, label, detail) => {
  console.log(ok ? 'ok  ' : 'FAIL', label)
  if (!ok) { failures++; if (detail !== undefined) console.log('     ', JSON.stringify(detail)) }
}

const write = (name, body) => writeFileSync(join(TESTS, `${name}.js`), body)

try {
  mkdirSync(TESTS, { recursive: true })

  write('probe-empty', `export default {
  name: 'asserts nothing',
  level: 'level1',
  run(test) { if (1) return; test.ok(true, 'never reached') }
}
`)
  write('probe-notes', `export default {
  name: 'only notes',
  level: 'level1',
  run(test) { test.note('looked at it') }
}
`)
  write('probe-real', `export default {
  name: 'asserts something',
  level: 'level1',
  run(test) { test.ok(true, 'a real assertion'); test.ok(true, 'and another') }
}
`)

  const { engine } = await startWorldInNode({ root: ROOT })
  const result = await engine.run('tests.run')
  const byId = Object.fromEntries((result.tests || []).map(entry => [entry.id, entry]))

  check(byId['probe-empty']?.ok === false, 'an early return is NOT passing', byId['probe-empty'])
  check(/no assertions/.test(byId['probe-empty']?.error || ''), 'and says why', byId['probe-empty']?.error)
  check(byId['probe-notes']?.ok === false, 'notes alone are not assertions', byId['probe-notes'])
  check(byId['probe-real']?.ok === true, 'a real test still passes', byId['probe-real'])
  check(byId['probe-real']?.assertions === 2, 'and reports how many it made', byId['probe-real']?.assertions)
  check(typeof result.assertions === 'number', 'the summary carries a total', result.assertions)
} finally {
  for (const name of ['probe-empty', 'probe-notes', 'probe-real']) {
    rmSync(join(TESTS, `${name}.js`), { force: true })
  }
  console.log('probe tests removed')
}

console.log(failures ? `\n${failures} FAILED` : '\nall clear')
process.exit(failures ? 1 : 0)
