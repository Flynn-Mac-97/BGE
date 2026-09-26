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

/** The materials of every mesh an attachment group draws. */
const materialsIn = group => {
  const found = []
  group.traverse(node => node.isMesh && found.push(node.material))
  return found
}

test('a ghost attachment draws see-through in its colour, and its own look comes back without it', () => {
  const { holder, bone } = holderWithBones()
  const solid = new THREE.MeshStandardMaterial()
  const scene = new THREE.Group()
  scene.add(new THREE.Mesh(new THREE.BoxGeometry(), solid))
  modelCache.set('sword.glb', { status: 'ready', scene, waiting: [] })
  applyAttachments(holder, { sword: { model: 'sword.glb', node: 'Hips', ghost: '#3080ff' } }, release)
  const [group] = hungOff(bone('Hips'))
  const [ghost] = materialsIn(group)
  assert.ok(ghost.transparent && ghost.opacity < 1, 'see-through')
  assert.equal(ghost.color.getHexString(), '3080ff', 'in its colour')
  applyAttachments(holder, { sword: { model: 'sword.glb', node: 'Hips', ghost: '#ff3020' } }, release)
  assert.equal(materialsIn(group)[0].color.getHexString(), 'ff3020', 'a new colour repaints it')
  applyAttachments(holder, { sword: { model: 'sword.glb', node: 'Hips' } }, release)
  assert.equal(materialsIn(group)[0].type, solid.type, 'with no ghost it is drawn solid again')
})
