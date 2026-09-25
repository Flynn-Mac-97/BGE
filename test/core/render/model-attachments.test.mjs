/**
 * `attachments`: models hung off a model's named nodes.
 *
 * The key names the attachment and is also the node, unless the entry gives
 * `node`. So several models can hang off one node, and moving one to another
 * node takes it off the first.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three/webgpu'
import { applyAttachments, indexNodes } from '../../../engine/render/model-nodes.js'
import { modelCache } from '../../../engine/render/model-cache.js'

/** A model of two named bones with a mesh on each, indexed the way a load indexes it. */
function holderWithBones() {
  const holder = new THREE.Group()
  const instance = new THREE.Group()
  for (const name of ['Hips', 'Spine']) {
    const bone = new THREE.Bone()
    bone.name = name
    bone.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()))
    instance.add(bone)
  }
  holder.add(instance)
  indexNodes(holder, instance)
  return { holder, bone: name => instance.children.find(child => child.name === name) }
}

/** The groups hung off one bone by attachments. */
const hungOff = bone => bone.children.filter(child => child.isGroup)

modelCache.set('potion.glb', { status: 'ready', scene: new THREE.Group(), waiting: [] })
const release = () => {}

test('two attachments that name one node both hang off it', () => {
  const { holder, bone } = holderWithBones()
  applyAttachments(
    holder,
    { potionA: { model: 'potion.glb', node: 'Hips' }, potionB: { model: 'potion.glb', node: 'Hips' } },
    release
  )
  assert.equal(hungOff(bone('Hips')).length, 2)
})

test('an attachment with no node hangs off the node its key names', () => {
  const { holder, bone } = holderWithBones()
  applyAttachments(holder, { Spine: 'potion.glb' }, release)
  assert.equal(hungOff(bone('Spine')).length, 1)
})

test("changing an attachment's node moves it there and off the old node", () => {
  const { holder, bone } = holderWithBones()
  applyAttachments(holder, { potion: { model: 'potion.glb', node: 'Hips' } }, release)
  applyAttachments(holder, { potion: { model: 'potion.glb', node: 'Spine' } }, release)
  assert.equal(hungOff(bone('Hips')).length, 0)
  assert.equal(hungOff(bone('Spine')).length, 1)
})

test('a position written as [x, y, z] places the attachment, the same as {x, y, z}', () => {
  const { holder, bone } = holderWithBones()
  applyAttachments(holder, { potion: { model: 'potion.glb', node: 'Hips', position: [0.1, 0.2, 0.3] } }, release)
  const [group] = hungOff(bone('Hips'))
  assert.deepEqual([group.position.x, group.position.y, group.position.z], [0.1, 0.2, 0.3])
})

test('changing only the file keeps the old model shown until the new one lands', () => {
  const { holder, bone } = holderWithBones()
  const loading = { status: 'loading', scene: null, waiting: [] }
  modelCache.set('potion-empty.glb', loading)
  applyAttachments(holder, { potion: { model: 'potion.glb', node: 'Hips' } }, release)
  const [group] = hungOff(bone('Hips'))
  const shown = group.children[0]
  applyAttachments(holder, { potion: { model: 'potion-empty.glb', node: 'Hips' } }, release)
  assert.deepEqual(group.children, [shown], 'the old model is still shown while the new file loads')
  loading.status = 'ready'
  loading.scene = new THREE.Group()
  for (const waiter of loading.waiting) waiter.onReady(loading.scene)
  assert.equal(hungOff(bone('Hips'))[0], group, 'in the same group')
  assert.equal(group.children.length, 1, 'and only the new model once it lands')
  assert.notEqual(group.children[0], shown)
})
