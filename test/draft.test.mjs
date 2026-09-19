import test from 'node:test'
import assert from 'node:assert/strict'
import draft from '../plugins/builtin/draft.js'

/** A document store that checks revisions the way the engine's does. */
function world() {
  const documents = new Map()
  const files = {
    async listDocuments() {
      return {
        documents: [...documents.entries()].map(([id, value]) => ({
          id, title: value.data.title, revision: value.revision, updatedAt: value.updatedAt
        })),
        errors: []
      }
    },
    async readDocument(id) { return documents.get(id) ?? null },
    async writeDocument(id, data, revision) {
      const current = documents.get(id)
      if ((current?.revision ?? null) !== (revision ?? null)) {
        throw new Error('Revision conflict: another editor saved this document.')
      }
      const value = { revision: `r${documents.size + 1}`, updatedAt: 'now', data }
      documents.set(id, value)
      return value
    }
  }
  return { context: { files, redraw() {}, shell: null }, documents }
}

const commands = Object.fromEntries(draft.commands.map((command) => [command.id, command]))
const run = (context, id, args) => commands[id].run(context, args)

test('draft.plan writes a board and draft.read returns the plan shape', async () => {
  const { context, documents } = world()
  const created = await run(context, 'draft.plan', {
    title: 'Rendering',
    nodes: [['camera', 'text', 'Camera', [40, 60]], ['fbo', 'text', 'Render to FBO'], ['ref', 'image', 'ref.png']],
    edges: [['camera', 'fbo', 'draws'], ['fbo', 'ref']]
  })
  assert.equal(created.id, 'draft-rendering')
  assert.match(created.outline, /camera/)
  assert.ok(documents.has('draft-rendering'))

  const data = await run(context, 'draft.read', { id: 'rendering' })
  assert.equal(data.nodes.length, 3)
  assert.deepEqual(data.nodes[0], { id: 'camera', kind: 'text', text: 'Camera', at: [40, 60] })
  assert.deepEqual(data.edges[0], { from: 'camera', to: 'fbo', text: 'draws' })
  assert.equal(data.edges[1].text, undefined)
})

test('draft.show names every box and arrow in words', async () => {
  const { context } = world()
  await run(context, 'draft.new', { title: 'Flow' })
  await run(context, 'draft.add', { id: 'flow', kind: 'note', text: 'one idea' })
  const shown = await run(context, 'draft.show', { id: 'flow' })
  assert.match(shown.outline, /draft "Flow" id=draft-flow/)
  assert.match(shown.outline, /one idea/)
})

test('a box added headless is saved and comes back on the next call', async () => {
  const { context } = world()
  await run(context, 'draft.plan', { title: 'Pickups', nodes: [['spawn', 'text', 'Spawn']] })
  await run(context, 'draft.add', { id: 'pickups', kind: 'text', text: 'Attract' })
  await run(context, 'draft.connect', { id: 'pickups', from: 'spawn', to: 'attract' })

  const data = await run(context, 'draft.read', { id: 'pickups' })
  assert.ok(data.nodes.some((node) => node.id === 'attract' && node.text === 'Attract'))
  assert.deepEqual(data.edges.at(-1), { from: 'spawn', to: 'attract' })
})

test('draft.set changes a box and draft.remove takes its arrows with it', async () => {
  const { context } = world()
  await run(context, 'draft.plan', {
    title: 'Combat',
    nodes: [['hit', 'text', 'Hit'], ['hurt', 'text', 'Hurt']],
    edges: [['hit', 'hurt']]
  })
  await run(context, 'draft.set', { id: 'combat', node: 'hurt', text: 'Take damage' })
  let data = await run(context, 'draft.read', { id: 'combat' })
  assert.equal(data.nodes.find((node) => node.id === 'hurt').text, 'Take damage')

  const removed = await run(context, 'draft.remove', { id: 'combat', node: 'hurt' })
  assert.match(removed.removed, /1 edge/)
  data = await run(context, 'draft.read', { id: 'combat' })
  assert.equal(data.nodes.length, 1)
  assert.equal(data.edges.length, 0)
})

test('a duplicate arrow, a self arrow and an unknown kind are refused by name', async () => {
  const { context } = world()
  await run(context, 'draft.plan', {
    title: 'Rules',
    nodes: [['a', 'text', 'A'], ['b', 'text', 'B']],
    edges: [['a', 'b']]
  })
  await assert.rejects(() => run(context, 'draft.connect', { id: 'rules', from: 'a', to: 'b' }), /already points at/)
  await assert.rejects(() => run(context, 'draft.connect', { id: 'rules', from: 'a', to: 'a' }), /cannot point at itself/)
  await assert.rejects(() => run(context, 'draft.plan', { title: 'Bad', nodes: [['x', 'blob', '']] }), /unknown node kind/)
  await assert.rejects(() => run(context, 'draft.connect', { id: 'rules', from: 'a', to: 'ghost' }), /unknown node "ghost"/)
})

test('replacing a plan keeps the position of every box that keeps its id', async () => {
  const { context } = world()
  await run(context, 'draft.plan', { title: 'Keep', nodes: [['a', 'text', 'A', [120, 340]], ['b', 'text', 'B']] })
  await run(context, 'draft.plan', { id: 'keep', title: 'Keep', nodes: [['a', 'text', 'A renamed'], ['c', 'text', 'C']] })
  const data = await run(context, 'draft.read', { id: 'keep' })
  assert.deepEqual(data.nodes.find((node) => node.id === 'a').at, [120, 340])
  assert.equal(data.nodes.find((node) => node.id === 'a').text, 'A renamed')
})

test('a write that races another is refused and reported', async () => {
  const { context, documents } = world()
  await run(context, 'draft.plan', { title: 'Race', nodes: [['a', 'text', 'A']] })
  const stored = documents.get('draft-race')
  documents.set('draft-race', { ...stored, revision: 'written-by-someone-else' })
  await assert.rejects(() => run(context, 'draft.add', { id: 'race', kind: 'text', text: 'B' }), /Revision conflict/)
})
