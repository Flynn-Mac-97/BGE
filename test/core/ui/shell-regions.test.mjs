/**
 * The region registry, without a browser.
 *
 * `shell.js` builds the frame and hands its region elements to
 * `shell-regions.js`. Which mount lands where, in what order, and when it
 * leaves is a plain set of rules over the DOM, so this installs the smallest
 * DOM those rules touch and reads the order back from the host's children.
 *
 * The disable sweep is the point: a mount that outlived its plugin would be DOM
 * nothing owns and nothing can reach.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { makeRegions } from '../../../engine/shell-regions.js'

/** One element, with the child operations the registry reaches for. */
class FakeElement {
  constructor(name) {
    this.name = name
    this.children = []
    this.parentNode = null
  }

  append(child) {
    if (child.parentNode) child.parentNode.removeChild(child)
    this.children.push(child)
    child.parentNode = this
  }

  insertBefore(child, before) {
    if (child.parentNode) child.parentNode.removeChild(child)
    const at = this.children.indexOf(before)
    if (at === -1) { this.children.push(child); child.parentNode = this; return }
    this.children.splice(at, 0, child)
    child.parentNode = this
  }

  removeChild(child) {
    const at = this.children.indexOf(child)
    if (at !== -1) { this.children.splice(at, 1); child.parentNode = null }
  }
}

/** The names of a host's children, in DOM order. */
const names = host => host.children.map(child => child.name)

test('a mount appears in its region in order', () => {
  const overlay = new FakeElement('overlay')
  const regions = makeRegions({ overlay })

  const late = new FakeElement('late')
  const second = new FakeElement('second')
  const first = new FakeElement('first')
  regions.mount('overlay', late, { order: 30 })
  regions.mount('overlay', second, { order: 20 })
  regions.mount('overlay', first, { order: 10 })

  assert.deepEqual(names(overlay), ['first', 'second', 'late'])
})

test('a tie keeps the order the mounts were made in', () => {
  const overlay = new FakeElement('overlay')
  const regions = makeRegions({ overlay })

  const a = new FakeElement('a')
  const b = new FakeElement('b')
  regions.mount('overlay', a, { order: 50 })
  regions.mount('overlay', b, { order: 50 })

  assert.deepEqual(names(overlay), ['a', 'b'])
})

test('mounting one element again moves it rather than adding it twice', () => {
  const overlay = new FakeElement('overlay')
  const regions = makeRegions({ overlay })

  const a = new FakeElement('a')
  const b = new FakeElement('b')
  regions.mount('overlay', a, { order: 10 })
  regions.mount('overlay', b, { order: 20 })
  regions.mount('overlay', a, { order: 30 })

  assert.equal(overlay.children.length, 2)
  assert.deepEqual(names(overlay), ['b', 'a'])
})

test('unmount takes the element out, and a second unmount does nothing', () => {
  const overlay = new FakeElement('overlay')
  const regions = makeRegions({ overlay })

  const a = new FakeElement('a')
  const b = new FakeElement('b')
  regions.mount('overlay', a)
  regions.mount('overlay', b)

  assert.equal(regions.unmount(a), true)
  assert.deepEqual(names(overlay), ['b'])
  assert.equal(a.parentNode, null)
  assert.equal(regions.unmount(a), false)
})

test('clear empties one region and leaves another alone', () => {
  const overlay = new FakeElement('overlay')
  const bar = new FakeElement('bar')
  const regions = makeRegions({ overlay, bar })

  const a = new FakeElement('a')
  const b = new FakeElement('b')
  regions.mount('overlay', a)
  regions.mount('bar', b)

  regions.clear('overlay')

  assert.deepEqual(names(overlay), [])
  assert.deepEqual(names(bar), ['b'])
})

test('a disabled plugin\'s mount is swept', () => {
  const overlay = new FakeElement('overlay')
  const regions = makeRegions({ overlay })

  const kept = new FakeElement('kept')
  const dropped = new FakeElement('dropped')
  regions.mount('overlay', kept, { plugin: 'Kept' })
  regions.mount('overlay', dropped, { plugin: 'Dropped' })

  regions.sweep(name => name === 'Kept')

  assert.deepEqual(names(overlay), ['kept'])
  assert.equal(dropped.parentNode, null)
})

test('an unmounted or unknown region is refused, not thrown', () => {
  const overlay = new FakeElement('overlay')
  const regions = makeRegions({ overlay })

  assert.equal(regions.mount('nowhere', new FakeElement('x')), null)
  assert.equal(regions.mount('overlay', null), null)
  assert.deepEqual(regions.names, ['overlay'])
})
