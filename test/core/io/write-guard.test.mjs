/**
 * The kernel is the only writer to disk, so the guard belongs to it.
 *
 * Driven against `makeFiles` directly: no server, no browser, no plugin. What
 * is proved is that a refused write never reaches the transport, that the
 * reason names the path and who asked, and that an ordinary write is untouched.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { makeFiles } from '../../../engine/files.js'
import { WRITES_A_FILE, WRITING_OPS, permits } from '../../../engine/work-lock.mjs'

/** A transport that records instead of writing, so a leak through is visible. */
const recorder = () => {
  const written = []
  return {
    written,
    async write(path, text) {
      written.push({ scope: 'project', path, text })
    },
    async writeAgent(scope, path, text) {
      written.push({ scope, path, text })
    }
  }
}

const silentBus = () => ({ emit() {} })

/** Set `__engineViewer` for one call and put it back, whatever happens. */
const asLaneRenderPage = async (lane, body) => {
  const before = globalThis.__engineViewer
  globalThis.__engineViewer = lane
  try {
    return await body()
  } finally {
    globalThis.__engineViewer = before
  }
}

test('an unguarded write reaches disk', async () => {
  const transport = recorder()
  const files = makeFiles(silentBus(), transport)

  await files.write('levels/meadow.json', '{"entities":[]}')
  await files.writeJSON('levels/other.json', { entities: [] })
  await files.writeAgent('project', 'agents/notes.md', 'text')

  assert.deepEqual(
    transport.written.map(one => one.path),
    ['levels/meadow.json', 'levels/other.json', 'agents/notes.md']
  )
  assert.equal(files.pending, 0)
})

test('a lane render page is refused, and the reason names the lane and the file', async () => {
  const transport = recorder()
  const files = makeFiles(silentBus(), transport)

  await asLaneRenderPage('lane-a', async () => {
    await assert.rejects(
      () => files.write('levels/meadow.json', 'rewritten'),
      error => {
        assert.match(error.message, /levels\/meadow\.json/, 'says which file')
        assert.match(error.message, /lane-a/, 'says who asked')
        assert.match(error.message, /never writes the shared checkout/, 'says why')
        return true
      }
    )
    await assert.rejects(() => files.writeAgent('engine', 'agents/core.md', 'rewritten'))
  })

  assert.deepEqual(transport.written, [], 'nothing reached the transport')
  assert.equal(files.pending, 0, 'a refused write counts as no pending write')
})

test('the same page writes again once it is not rendering for a lane', async () => {
  const transport = recorder()
  const files = makeFiles(silentBus(), transport)

  await asLaneRenderPage('lane-a', () => assert.rejects(() => files.write('levels/meadow.json', 'rewritten')))
  await files.write('levels/meadow.json', 'edited by the person')

  assert.deepEqual(transport.written, [{ scope: 'project', path: 'levels/meadow.json', text: 'edited by the person' }])
})

test('the kernel guard cannot be removed by a plugin taking its own back off', async () => {
  const transport = recorder()
  const files = makeFiles(silentBus(), transport)

  const remove = files.guardWrites(() => 'a plugin says no')
  await assert.rejects(() => files.write('levels/meadow.json', 'x'), /a plugin says no/)
  remove()
  await files.write('levels/meadow.json', 'x')

  await asLaneRenderPage('lane-a', () =>
    assert.rejects(() => files.write('levels/meadow.json', 'x'), /never writes the shared checkout/)
  )
  assert.equal(transport.written.length, 1, 'only the write nobody refused landed')
})

/**
 * `POST /api/file` and `POST /api/agent-file` ask Work Lock about `code.save`,
 * the op that puts text at a path. Both sets have to hold that name or the file
 * routes go open again while the code still reads as guarded.
 */
test('the op the file routes are judged as is refused for both callers', () => {
  assert.ok(WRITING_OPS.has('code.save'), 'held from the person while a lane works')
  assert.ok(WRITES_A_FILE.has('code.save'), 'refused to a lane render page always')

  const free = { locked: false, holders: [] }
  const held = { locked: true, why: 'a lane is working: lane-a.' }
  assert.equal(permits(free, 'code.save', 'person').allowed, true)
  assert.equal(permits(free, 'code.save', 'lane').allowed, false)
  assert.equal(permits(held, 'code.save', 'person').allowed, false)
})

test('a guard that throws refuses the write', async () => {
  const transport = recorder()
  const files = makeFiles(silentBus(), transport)

  files.guardWrites(() => {
    throw new Error('the registry is unreadable')
  })
  await assert.rejects(() => files.write('levels/meadow.json', 'x'), /the registry is unreadable/)
  assert.deepEqual(transport.written, [])
})
