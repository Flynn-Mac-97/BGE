/**
 * One set of process-wide error channels, however many worlds there are.
 *
 * A world cannot listen for an uncaught throw or a rejected promise itself: node
 * and the browser report both on a channel that belongs to the process. Wiring
 * that up per world meant eleven worlds installed eleven pairs of listeners — node
 * warns about a leak at eleven — and each listener held its own world's log
 * reachable for the life of the process.
 *
 * **The process channels cannot be provoked from here.** `node --test` installs its
 * own `unhandledRejection` and `uncaughtException` listeners and fails the file for
 * either, so emitting one by hand raises "probe rejection" as a test failure rather
 * than reaching the assertion. The routing those two share is the same
 * `reportToLogs` path the console test below covers, and the sources themselves
 * were proved by hand: emitting each event in a plain script puts
 * `error/rejection` and `error/uncaught` in the log, one listener per channel.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { CHECKOUT, temporaryProject } from '../fixture-project.mjs'
import { startWorldInNode } from '../../engine/start-world-node.mjs'

const PROJECT = {
  'game.json': { title: 'log-wiring', startLevel: 'main' },
  'levels/main.json': { entities: [{ type: 'thing', at: [0, 0, 0] }] },
  'types/thing.js': 'export default { properties: {} }\n'
}

const boot = async project => (await startWorldInNode({ root: CHECKOUT, project })).context

test('twelve worlds do not each bring their own process listeners', async () => {
  const project = await temporaryProject(PROJECT, 'log-wiring-')
  try {
    const before = {
      rejection: process.listenerCount('unhandledRejection'),
      uncaught: process.listenerCount('uncaughtException')
    }

    for (let at = 0; at < 12; at++) await boot(project)

    const added = {
      rejection: process.listenerCount('unhandledRejection') - before.rejection,
      uncaught: process.listenerCount('uncaughtException') - before.uncaught
    }
    assert.ok(added.rejection <= 1, `twelve worlds added ${added.rejection} rejection listeners`)
    assert.ok(added.uncaught <= 1, `twelve worlds added ${added.uncaught} uncaught listeners`)
  } finally {
    await fs.rm(project, { recursive: true, force: true })
  }
})

test('a console error lands in every world once, not once per world', async () => {
  const project = await temporaryProject(PROJECT, 'log-wiring-')
  try {
    const first = await boot(project)
    const second = await boot(project)

    console.error('probe console message')

    for (const [which, context] of [['first', first], ['second', second]]) {
      const seen = context.engine.errors().filter(entry => /probe console message/.test(entry.message))
      assert.equal(seen.length, 1, `the ${which} world logged it ${seen.length} times`)
      assert.equal(seen[0].source, 'console')
    }
  } finally {
    await fs.rm(project, { recursive: true, force: true })
  }
})
