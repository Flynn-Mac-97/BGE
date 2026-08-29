/**
 * A test can reach the engine, not just the world.
 *
 * p21/p22/p28: a test was handed `test` and never `context`, so nothing a
 * plugin contributed could be asked anything. Three builtins published a
 * module-level handle purely so a test could import it back — which worked only
 * because a plugin module is a singleton, and read like a trick.
 *
 *   node agent-runs/2026-08-30-parallel/test-context.mjs
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
const NAMES = ['probe-context', 'probe-run', 'probe-on', 'probe-leak-a', 'probe-leak-b']

try {
  mkdirSync(TESTS, { recursive: true })

  write('probe-context', `export default {
  name: 'reaches the live context',
  level: 'level1',
  run(test) {
    test.ok(!!test.context, 'context is handed to the test')
    test.ok(test.context.world === test.entities.constructor ? false : !!test.context.world, 'and carries the world')
    // A plugin-contributed verb, the thing that used to need a module import.
    test.ok(typeof test.context.canStand === 'function', 'physics-3d contributed canStand')
    test.ok(!!test.context.input, 'keyboard input is on context')
  }
}
`)

  write('probe-run', `export default {
  name: 'drives a command',
  level: 'level1',
  run(test) {
    const list = test.run('plugins.list')
    test.ok(Array.isArray(list) || !!list, 'test.run returned something')
  }
}
`)

  write('probe-on', `export default {
  name: 'hears the bus',
  level: 'level1',
  run(test) {
    let heard = 0
    test.on('world:changed', () => { heard++ })
    test.spawn('player', { x: 3, y: 0 })
    test.ok(heard > 0, 'a spawn was heard on the bus')
  }
}
`)

  // Two tests, alphabetically in order. The first subscribes; if the handler
  // survives into the second, the count below is wrong.
  write('probe-leak-a', `export default {
  name: 'subscribes and leaves',
  level: 'level1',
  run(test) {
    globalThis.__leak = 0
    test.on('world:changed', () => { globalThis.__leak++ })
    test.spawn('player', { x: 1, y: 0 })
    test.is(globalThis.__leak, 1, 'heard its own spawn')
  }
}
`)
  write('probe-leak-b', `export default {
  name: 'does not inherit the subscription',
  level: 'level1',
  run(test) {
    test.spawn('player', { x: 2, y: 0 })
    test.is(globalThis.__leak, 1, 'the previous test unsubscribed')
  }
}
`)

  const { engine } = await startWorldInNode({ root: ROOT })
  const result = await engine.run('tests.run')
  const byId = Object.fromEntries((result.tests || []).map(entry => [entry.id, entry]))
  const why = id => byId[id]?.error || byId[id]?.fails

  check(byId['probe-context']?.ok === true, 'a test reaches context and its contributed verbs', why('probe-context'))
  check(byId['probe-run']?.ok === true, 'a test drives a command', why('probe-run'))
  check(byId['probe-on']?.ok === true, 'a test hears the bus', why('probe-on'))
  check(byId['probe-leak-a']?.ok === true, 'a subscribing test passes', why('probe-leak-a'))
  check(byId['probe-leak-b']?.ok === true, 'and its handler does not leak into the next', why('probe-leak-b'))
} finally {
  for (const name of NAMES) rmSync(join(TESTS, `${name}.js`), { force: true })
  console.log('probe tests removed')
}

console.log(failures ? `\n${failures} FAILED` : '\nall clear')
process.exit(failures ? 1 : 0)
