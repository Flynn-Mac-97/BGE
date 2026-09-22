/**
 * The kernel boots with no plugin at all.
 *
 * This is the anchor the rest of the shrink rests on: if the kernel ever grows
 * a hard dependency on a plugin, every later step is built on a boot that needs
 * one. Turning every registered plugin off and still loading, stepping and
 * hashing is the whole claim.
 *
 * The disabled list is read from the plugin files rather than written out, so
 * the test keeps meaning as plugins are added or removed.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { CHECKOUT, temporaryProject } from '../fixture-project.mjs'
import { startWorldInNode } from '../../engine/start-world-node.mjs'
import { stateHash } from '../../engine/world.js'

/** Every plugin definition the finder would register, read from the files on disk. */
async function builtinDefinitions() {
  const directory = path.join(CHECKOUT, 'plugins/builtin')
  const files = (await fs.readdir(directory)).filter(name => name.endsWith('.js')).sort()
  const definitions = []
  for (const file of files) {
    const module = await import(pathToFileURL(path.join(directory, file)).href)
    if (module.default?.name) definitions.push(module.default)
  }
  return definitions
}

/**
 * The names, every dependent before the plugin it needs.
 *
 * The loader logs an error for each dependent it has to turn off when a
 * provider goes. Disabling dependents first leaves nothing for the cascade to
 * find, so a full shutdown is silent. A dependency from `requires` counts the
 * same as one from `needs`, because the loader resolves both to the provider.
 */
function dependentsFirst(definitions) {
  const providerOf = new Map()
  for (const definition of definitions) {
    for (const key of definition.provides || []) providerOf.set(key, definition.name)
  }
  const byName = new Map(definitions.map(definition => [definition.name, definition]))
  const needsOf = definition => [
    ...(definition.needs || []),
    ...(definition.requires || []).map(key => providerOf.get(key)).filter(Boolean)
  ]
  const depth = new Map()
  const depthOf = definition => {
    if (depth.has(definition.name)) return depth.get(definition.name)
    depth.set(definition.name, 0)
    let value = 0
    for (const need of needsOf(definition)) {
      const provider = byName.get(need)
      if (provider) value = Math.max(value, 1 + depthOf(provider))
    }
    depth.set(definition.name, value)
    return value
  }
  return definitions.slice().sort((a, b) => depthOf(b) - depthOf(a)).map(definition => definition.name)
}

test('the kernel boots and steps with every plugin disabled', async () => {
  const disabled = dependentsFirst(await builtinDefinitions())
  assert.ok(disabled.length > 0, 'the disabled list comes from the plugins on disk')

  const project = await temporaryProject({
    'game.json': { title: 'bare-boot', startLevel: 'main', plugins: { disabled } },
    'levels/main.json': { entities: [{ type: 'mover', at: [0, 0, 0] }] },
    // A type that writes a field every step, so the hash has something real to
    // notice. A static entity would pass even if the loop never ran.
    'types/mover.js': `export default {
  properties: {},
  update(entity, seconds) { entity.elapsed = (entity.elapsed || 0) + seconds }
}
`
  })

  try {
    const { context, engine } = await startWorldInNode({ root: CHECKOUT, project })
    const started = engine.snapshot()

    assert.equal(started.counts.plugins, 0, 'no plugin may load')
    assert.equal(started.level, 'main', 'the level loaded')
    assert.equal(started.counts.entities, 1, 'the level loaded its entity')
    assert.deepEqual(started.errors, [], 'boot logged no error')

    const before = stateHash(context.world)
    engine.simulate(1)
    assert.notEqual(stateHash(context.world), before, 'a step changed the world')

    assert.deepEqual(engine.snapshot().errors, [], 'the step logged no error')
  } finally {
    await fs.rm(project, { recursive: true, force: true })
  }
})
