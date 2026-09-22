import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { buildIndex } from '../../engine/project-index.mjs'

/**
 * What the editor alone acts on, per record kind.
 *
 * The agent view is cut from the entry, so this list is the one place a new
 * entry field can be withheld. A field that is in neither this list nor the
 * agent view fails the test below, which is the decision nobody should be able
 * to make by forgetting.
 */
const EDITOR_ONLY = {
  types: ['usesBy', 'meshBox', 'colliderBox', 'meshTint', 'animation', 'inLevels'],
  behaviours: ['usedBy'],
  levels: ['assets'],
  tests: []
}

/** Every optional field a type can declare, so a dropped one is visible. */
const TYPE = `export default {
  about: 'a crate',
  appearance: 'a brown box',
  looksWrongWhen: 'it floats',
  invariant: { standsOn: 'ground' },
  mesh: { box: [1, 1, 1], tint: '#7a3cff' },
  animation: { idle: { from: 0, to: 1 } },
  behaviours: ['spin'],
  properties: { health: 10 }
}
`

const BEHAVIOUR = `export default {
  about: 'turns slowly',
  properties: { speed: 1 },
  update() {}
}
`

const TEST_FILE = `export default { name: 'smoke', level: 'arena' }
`

/** One project holding a record of every kind. */
async function projectWithEverything() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-index-'))
  for (const folder of ['types', 'behaviours', 'levels', 'tests', 'assets']) {
    await fs.mkdir(path.join(directory, folder), { recursive: true })
  }
  await fs.writeFile(path.join(directory, 'types/crate.js'), TYPE)
  await fs.writeFile(path.join(directory, 'behaviours/spin.js'), BEHAVIOUR)
  await fs.writeFile(path.join(directory, 'levels/arena.json'), JSON.stringify({
    entities: [{ id: 'one', type: 'crate', sprite: 'probe.png', behaviours: { spin: {} } }]
  }))
  await fs.writeFile(path.join(directory, 'tests/smoke.js'), TEST_FILE)
  await fs.writeFile(path.join(directory, 'assets/probe.png'), '')
  return directory
}

test('the agent view carries every entry field except the ones the editor alone acts on', async () => {
  const directory = await projectWithEverything()
  try {
    const index = await buildIndex(directory)
    const agent = JSON.parse(await fs.readFile(path.join(directory, '.engine/index.agent.json'), 'utf8'))
    for (const kind of ['types', 'behaviours', 'levels', 'tests']) {
      assert.ok(Object.keys(index[kind]).length, `${kind} fixture holds nothing`)
      for (const [name, record] of Object.entries(index[kind])) {
        const written = agent[kind][name]
        for (const [field, value] of Object.entries(record)) {
          if (EDITOR_ONLY[kind].includes(field)) {
            assert.equal(written[field], undefined, `${kind} "${name}" writes editor-only ${field}`)
            continue
          }
          if (value === undefined) continue
          // An empty list is a fact only for the fields the index always writes.
          if (Array.isArray(value) && !value.length && !['properties', 'hooks', 'types', 'behaviours'].includes(field)) continue
          assert.deepEqual(written[field], JSON.parse(JSON.stringify(value)), `${kind} "${name}" drops ${field}`)
        }
        for (const field of Object.keys(written)) {
          assert.ok(field in record, `${kind} "${name}" writes ${field}, which no entry declares`)
        }
      }
    }
  } finally { await fs.rm(directory, { recursive: true, force: true }) }
})
