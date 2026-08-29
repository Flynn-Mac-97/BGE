/**
 * Drive the shortcut matcher without a browser.
 *
 * The listener itself needs a document, but the two parts that can be wrong on
 * their own — the spelling a key event is turned into, and the table a
 * declaration goes into — are plain functions. This presses keys at them.
 *
 * Run: node agent-runs/2026-08-29-keyboard-shortcuts/check-shortcut-matcher.mjs
 */
import { shortcutFromEvent, readShortcut, typingIn, collectShortcuts } from '../../engine/shell.js'

const failures = []
const check = (what, got, wanted) => {
  const same = JSON.stringify(got) === JSON.stringify(wanted)
  if (!same) failures.push(`${what}\n    wanted ${JSON.stringify(wanted)}\n    got    ${JSON.stringify(got)}`)
  console.log(`${same ? 'ok  ' : 'FAIL'} ${what}`)
}

const keyEvent = (key, { ctrl = false, shift = false, alt = false, meta = false } = {}) =>
  ({ key, ctrlKey: ctrl, shiftKey: shift, altKey: alt, metaKey: meta })

// ---- the event spelling
check('Control+z spells ctrl+z', shortcutFromEvent(keyEvent('z', { ctrl: true })), 'ctrl+z')
check('Meta+z spells ctrl+z too', shortcutFromEvent(keyEvent('z', { meta: true })), 'ctrl+z')
check('Control+Shift+z spells ctrl+shift+z, with the key the browser reports uppercase',
  shortcutFromEvent(keyEvent('Z', { ctrl: true, shift: true })), 'ctrl+shift+z')
check('Delete on its own spells delete', shortcutFromEvent(keyEvent('Delete')), 'delete')
check('the modifiers keep the contract order',
  shortcutFromEvent(keyEvent('ArrowLeft', { alt: true, shift: true, ctrl: true })), 'ctrl+shift+alt+arrowleft')

// ---- the declaration spelling
check("'ctrl+z' reads back as itself", readShortcut('ctrl+z'), 'ctrl+z')
check("'shift+ctrl+z' is put into the contract order", readShortcut('shift+ctrl+z'), 'ctrl+shift+z')
check("'space' is the space bar the browser reports", readShortcut('space'), ' ')
check("'meta+z' is refused rather than read as bare z", readShortcut('meta+z'), null)
check('a declaration with no key is refused', readShortcut('ctrl+'), null)

// ---- what the listener actually does with them
const table = collectShortcuts([
  { key: 'ctrl+z', what: 'command', name: 'history.undo', plugin: 'History' }
])
const matched = event => table.get(shortcutFromEvent(event))?.name ?? null
check("'ctrl+z' matches a Control+z press", matched(keyEvent('z', { ctrl: true })), 'history.undo')
check("'ctrl+z' matches a Command+z press", matched(keyEvent('z', { meta: true })), 'history.undo')
check("'ctrl+z' does NOT match Control+Shift+z", matched(keyEvent('Z', { ctrl: true, shift: true })), null)
check("'ctrl+z' does NOT match a bare z", matched(keyEvent('z')), null)

// ---- the guard
check('a shortcut stays out of an input', typingIn({ tagName: 'INPUT' }), true)
check('a shortcut stays out of a textarea', typingIn({ tagName: 'TEXTAREA' }), true)
check('a shortcut stays out of a contentEditable element', typingIn({ isContentEditable: true }), true)
check('the frame itself is not typing', typingIn({ tagName: 'DIV' }), false)
check('no target at all is not typing', typingIn(null), false)

// ---- two claims on one key are reported by name, not resolved in silence
const said = []
const contested = collectShortcuts([
  { key: 'ctrl+z', what: 'command', name: 'history.undo', plugin: 'History' },
  { key: 'ctrl+z', what: 'command', name: 'edit.duplicate', plugin: 'Transform Tool' },
  { key: 'meta+q', what: 'command', name: 'app.quit', plugin: 'Nonsense' }
], message => said.push(message))
check('the first claim keeps the key', contested.get('ctrl+z').name, 'history.undo')
check('the second claim is not bound', [...contested.keys()], ['ctrl+z'])
check('both sides of the collision are named',
  said[0].includes('history.undo') && said[0].includes('edit.duplicate') && said[0].includes('Transform Tool'), true)
check('a declaration that is not a shortcut is reported too',
  said[1].includes('app.quit') && said[1].includes('meta+q'), true)
check('nothing else was said', said.length, 2)

console.log(said.map(m => '     reported: ' + m).join('\n'))
if (failures.length) {
  console.error(`\n${failures.length} failed:\n${failures.join('\n')}`)
  process.exit(1)
}
console.log('\nall clear')
