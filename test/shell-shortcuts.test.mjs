/**
 * The shortcut matcher, without a browser.
 *
 * `shell.js` owns the one keyboard listener, and the two parts that can be wrong
 * on their own are plain functions: the spelling a key event becomes, and the
 * table a plugin's declaration goes into. The listener itself needs a document;
 * these do not, so this presses keys at them directly.
 *
 * The collision case is why the shell owns the listener at all: two plugins on
 * one key have to be reported by name, because neither can see the other.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { shortcutFromEvent, readShortcut, typingIn, collectShortcuts } from '../engine/shell.js'

/** A key event with the modifiers a browser reports. */
const keyEvent = (key, { ctrl = false, shift = false, alt = false, meta = false } = {}) =>
  ({ key, ctrlKey: ctrl, shiftKey: shift, altKey: alt, metaKey: meta })

test('a key event spells into the contract order', () => {
  assert.equal(shortcutFromEvent(keyEvent('z', { ctrl: true })), 'ctrl+z')
  assert.equal(shortcutFromEvent(keyEvent('z', { meta: true })), 'ctrl+z')
  assert.equal(shortcutFromEvent(keyEvent('Z', { ctrl: true, shift: true })), 'ctrl+shift+z')
  assert.equal(shortcutFromEvent(keyEvent('Delete')), 'delete')
  assert.equal(shortcutFromEvent(keyEvent('ArrowLeft', { alt: true, shift: true, ctrl: true })), 'ctrl+shift+alt+arrowleft')
})

test('a declaration reads back in the same order, or is refused', () => {
  assert.equal(readShortcut('ctrl+z'), 'ctrl+z')
  assert.equal(readShortcut('shift+ctrl+z'), 'ctrl+shift+z')
  assert.equal(readShortcut('space'), ' ')
  assert.equal(readShortcut('meta+z'), null)
  assert.equal(readShortcut('ctrl+'), null)
})

test('the table matches a declaration against the keys a browser reports', () => {
  const table = collectShortcuts([
    { key: 'ctrl+z', what: 'command', name: 'history.undo', plugin: 'History' }
  ])
  const matched = event => table.get(shortcutFromEvent(event))?.name ?? null
  assert.equal(matched(keyEvent('z', { ctrl: true })), 'history.undo')
  assert.equal(matched(keyEvent('z', { meta: true })), 'history.undo')
  assert.equal(matched(keyEvent('Z', { ctrl: true, shift: true })), null)
  assert.equal(matched(keyEvent('z')), null)
})

test('a shortcut stays out of a place that is typing', () => {
  assert.equal(typingIn({ tagName: 'INPUT' }), true)
  assert.equal(typingIn({ tagName: 'TEXTAREA' }), true)
  assert.equal(typingIn({ isContentEditable: true }), true)
  assert.equal(typingIn({ tagName: 'DIV' }), false)
  assert.equal(typingIn(null), false)
})

test('two claims on one key are reported by name, and the first keeps it', () => {
  const said = []
  const table = collectShortcuts([
    { key: 'ctrl+z', what: 'command', name: 'history.undo', plugin: 'History' },
    { key: 'ctrl+z', what: 'command', name: 'edit.duplicate', plugin: 'Transform Tool' },
    { key: 'meta+q', what: 'command', name: 'app.quit', plugin: 'Nonsense' }
  ], message => said.push(message))
  assert.equal(table.get('ctrl+z').name, 'history.undo')
  assert.deepEqual([...table.keys()], ['ctrl+z'])
  assert.ok(said[0].includes('history.undo') && said[0].includes('edit.duplicate') && said[0].includes('Transform Tool'))
  assert.ok(said[1].includes('app.quit') && said[1].includes('meta+q'))
  assert.equal(said.length, 2)
})
