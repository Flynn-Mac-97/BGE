/**
 * Export: which files and plugins a built game carries, the guard on the
 * output folder, and one real build of a small game that the player can boot.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { exportGame, isRuntimeFile, runtimePlugins } from '../engine/export-game.mjs'

const CHECKOUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('a built game carries its runtime files and leaves out tests, agents, sources and caches', () => {
  for (const file of ['game.json', 'types/hero.js', 'behaviours/float.js', 'levels/main.json', 'assets/ui/theme.css', 'assets/models/hero.glb', 'plugins/radar.js']) {
    assert.equal(isRuntimeFile(file), true, file)
  }
  for (const file of ['tests/jump.js', 'agents/rules.md', 'tools/make-art.mjs', 'assets/models/hero.blend', 'assets/models/hero.blend1', 'plugins/radar.agent.md', 'README.md']) {
    assert.equal(isRuntimeFile(file), false, file)
  }
})

test('the export bundles runtime plugins only, and none the game turns off', async () => {
  const all = await runtimePlugins(CHECKOUT)
  const names = all.map(plugin => plugin.name)
  assert.ok(all.every(plugin => ['engine', 'visuals', 'game'].includes(plugin.category)), 'no editor or agent plugin')
  assert.ok(names.includes('Game UI') && names.includes('Render') && names.includes('Keyboard Input'))
  assert.equal(names.includes('Plugin Master'), false, 'editing-only plugins stay out')
  assert.equal(names.includes('Live File Updates'), false)
  const withoutHealth = await runtimePlugins(CHECKOUT, { plugins: { disabled: ['Health'] } })
  assert.equal(withoutHealth.some(plugin => plugin.name === 'Health'), false)
})

test('an export builds a game the player can boot, and replaces only an earlier export', { timeout: 120000 }, async () => {
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'engine-export-'))
  const project = path.join(scratch, 'tiny-game')
  const out = path.join(scratch, 'tiny-game-web')
  await fs.mkdir(path.join(project, 'levels'), { recursive: true })
  await fs.mkdir(path.join(project, 'types'), { recursive: true })
  await fs.mkdir(path.join(project, 'tests'), { recursive: true })
  await fs.writeFile(path.join(project, 'game.json'), JSON.stringify({ title: 'Tiny', startLevel: 'main' }))
  await fs.writeFile(path.join(project, 'levels/main.json'), JSON.stringify({ entities: [{ id: 'crate', type: 'crate', at: [0, 0, 0] }] }))
  await fs.writeFile(path.join(project, 'types/crate.js'), "export default { mesh: { box: [1, 1, 1] } }\n")
  await fs.writeFile(path.join(project, 'tests/crate.js'), 'export default {}\n')

  try {
    const result = await exportGame({ checkout: CHECKOUT, project, out })
    assert.equal(result.title, 'Tiny')
    const html = await fs.readFile(path.join(out, 'index.html'), 'utf8')
    assert.match(html, /src="\.\/assets\/player-[\w-]+\.js"/, 'the page loads the engine by a relative path, so it plays from any folder')
    const tree = JSON.parse(await fs.readFile(path.join(out, 'project-tree.json'), 'utf8')).map(entry => entry.path)
    assert.deepEqual(tree, ['game.json', 'levels/main.json', 'types/crate.js'])
    const index = JSON.parse(await fs.readFile(path.join(out, 'project-index.json'), 'utf8'))
    assert.ok(index.levels.main && index.types.crate)
    await fs.access(path.join(out, 'project/types/crate.js'))

    await exportGame({ checkout: CHECKOUT, project, out })
    const stranger = path.join(scratch, 'someone-elses')
    await fs.mkdir(stranger)
    await fs.writeFile(path.join(stranger, 'notes.txt'), 'keep me')
    await assert.rejects(exportGame({ checkout: CHECKOUT, project, out: stranger }), /refusing to empty/)
    await assert.rejects(exportGame({ checkout: CHECKOUT, project, out: path.join(project, 'build') }), /outside the project/)
    assert.equal(await fs.readFile(path.join(stranger, 'notes.txt'), 'utf8'), 'keep me')
  } finally {
    await fs.rm(scratch, { recursive: true, force: true })
  }
})

test('plugins.only bundles just the named plugins and what they require', async () => {
  const only = await runtimePlugins(CHECKOUT, { plugins: { only: ['Render', 'Game UI'] } })
  const names = only.map(plugin => plugin.name)
  assert.deepEqual(names.filter(name => ['Render', 'Game UI'].includes(name)).sort(), ['Game UI', 'Render'])
  assert.ok(names.length < (await runtimePlugins(CHECKOUT)).length, 'fewer plugins than the default')
  const provided = new Set(only.flatMap(plugin => plugin.provides))
  for (const key of only.flatMap(plugin => plugin.requires)) assert.ok(provided.has(key), `${key} has a provider`)
  await assert.rejects(runtimePlugins(CHECKOUT, { plugins: { only: ['No Such Plugin'] } }), /names no runtime plugin/)
})
