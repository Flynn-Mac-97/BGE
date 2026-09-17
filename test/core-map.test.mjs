import test from 'node:test'
import assert from 'node:assert/strict'
import { coreFilesMap } from '../plugins/builtin/systems-inspector/core-files.js'

test('the core map retains every file and links resolved imported calls at their source lines', () => {
  const catalog = { files: [
    { file:'index.html', text:'<script src="/engine/index.js"></script>' },
    { file:'engine/index.js', text:"import { start as bootWorld } from './world.js';\nfunction boot() { bootWorld(); unknown.start() }" },
    { file:'engine/world.js', text:'export function start() {}' },
    { file:'engine/unconnected.js', text:'const unused = 1' },
    { file:'engine/style.css', text:'body {}' }
  ], errors:[] }
  const map = coreFilesMap(catalog)
  assert.equal(map.nodes.length, 5)
  assert.equal(map.edges.length, 2)
  const call = map.edges.find(edge => edge.to === 'file:engine/world.js')
  assert.equal(call.label, 'boot → start')
  assert.equal(call.sites[0].line, 2)
  assert.equal(map.nodes.some(node => node.id === 'file:engine/unconnected.js'), true)
  assert.equal(coreFilesMap(catalog, [], 'imports').edges.find(edge => edge.to === call.to).sites[0].line, 1)
})
