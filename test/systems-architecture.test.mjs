import test from 'node:test'
import assert from 'node:assert/strict'
import { architectureView } from '../plugins/builtin/systems-inspector/toolkit/architecture-view.js'

const file = (path, lines, fanIn = 0) => ({ id: path, path, lines, fanIn, source: { file: path, line: 1 } })
const imports = (from, to) => ({ kind: 'import', from, to })

test('large modules become parts, helpers fold in, a shared utility stays its own part', () => {
  const nodes = [
    file('engine/render.js', 300),
    file('engine/render-shadows.js', 40),
    file('engine/world.js', 200),
    file('engine/paths.js', 20, 8),
    file('plugins/builtin/camera.js', 50)
  ]
  const edges = [
    imports('engine/render-shadows.js', 'engine/render.js'),
    imports('engine/render-shadows.js', 'engine/paths.js'),
    imports('engine/render.js', 'engine/paths.js'),
    imports('engine/world.js', 'engine/paths.js'),
    imports('plugins/builtin/camera.js', 'engine/render.js')
  ]
  const view = architectureView(nodes, edges)
  const by = title => view.nodes.find(node => node.title === title)
  // render is the biggest module in its region, so the small shadows file folds into it.
  assert.deepEqual(by('render').members.sort(), ['engine/render-shadows.js', 'engine/render.js'])
  // paths is tiny but imported widely; it stays its own part instead of swallowing the core.
  assert.deepEqual(by('paths').members, ['engine/paths.js'])
  assert.equal(by('world').members.length, 1)
  // a plugin is its own region, kept apart from the engine even though it imports render.
  assert.deepEqual(by('camera').members, ['plugins/builtin/camera.js'])
  // dependencies survive as edges between parts.
  assert.ok(view.edges.some(edge => edge.from === by('render').id && edge.to === by('paths').id))
  assert.ok(view.edges.some(edge => edge.from === by('camera').id && edge.to === by('render').id))
})

test('an empty scope reports it rather than drawing nothing silently', () => {
  assert.match(architectureView([], []).message, /No files/)
})
