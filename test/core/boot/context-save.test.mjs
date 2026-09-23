/**
 * `context.save()` writes the open level.
 *
 * `context.save` is the command a plugin calls after an edit — `tool-transform`
 * and `history` both call it with no arguments. It was set to the raw
 * `saveLevel(parts, options)`, so a bare call destructured `undefined` and threw
 * before reaching the file. `editor.saveLevel` was bound and correct; this is
 * that same binding on `context`.
 *
 * The world is booted for real, because the binding is made during start-up and
 * a direct call would prove nothing about what a plugin receives.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { CHECKOUT, temporaryProject } from '../../fixture-project.mjs'
import { startWorldInNode } from '../../../engine/start-world-node.mjs'

const PROJECT = {
  'game.json': {
    title: 'context-save',
    startLevel: 'main',
    plugins: { disabled: ['Physics 3D', 'Physics 2D'] }
  },
  'levels/main.json': {
    camera: { at: [0, 0] },
    entities: [{ id: 'marker', type: 'marker', at: [1, 2, 0] }]
  },
  'types/marker.js': `export default { mesh: { box: [1, 1, 1] } }\n`
}

test('context.save() and context.save(options) both write the open level', async () => {
  const directory = await temporaryProject(PROJECT)
  try {
    const { context } = await startWorldInNode({ root: CHECKOUT, project: directory })
    assert.equal(context.level(), 'main', 'a level is open to save')

    assert.deepEqual(
      await context.save(),
      { saved: 'levels/main.json' },
      'a bare context.save() writes the level instead of throwing'
    )
    assert.deepEqual(
      await context.save({ naming: false }),
      { saved: 'levels/main.json' },
      'an options argument is accepted too'
    )

    const written = JSON.parse(await fs.readFile(path.join(directory, 'levels/main.json'), 'utf8'))
    assert.ok(
      written.entities.some(entity => entity.id === 'marker'),
      'the written level holds the entity that was open'
    )
  } finally {
    await fs.rm(directory, { recursive: true, force: true })
  }
})
