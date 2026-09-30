/** UI Kit panel: an element's CSS is kept in the theme between marks, and every element renders. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { kit } from '../plugins/builtin/game-ui/components.js'
import { BASE_CSS } from '../plugins/builtin/game-ui/base-css.js'
import { blockOf, rulesOf, withBlock } from '../plugins/builtin/ui-kit/element-css.js'
import { ELEMENTS, defaultsOf } from '../plugins/builtin/ui-kit/elements.js'
import panelUiKit from '../plugins/builtin/panel-ui-kit.js'

test('a saved block reads back, and only that element changes', () => {
  const theme = ':root { --ui-accent: #f06 }\n'
  const first = withBlock(theme, 'button', '.ui-button { border-radius: 0 }')
  const both = withBlock(first, 'badge', '.ui-badge { color: red }')
  assert.equal(blockOf(both, 'button'), '.ui-button { border-radius: 0 }')
  assert.equal(blockOf(both, 'badge'), '.ui-badge { color: red }')
  assert.ok(both.startsWith(theme.trim()), 'the game keeps its own rules')
  const edited = withBlock(both, 'button', '.ui-button { border-radius: 4px }')
  assert.equal(blockOf(edited, 'button'), '.ui-button { border-radius: 4px }')
  assert.equal(blockOf(edited, 'badge'), '.ui-badge { color: red }')
})

test('empty rules take the block out', () => {
  const saved = withBlock('', 'button', '.ui-button { color: red }')
  const cleared = withBlock(saved, 'button', '  ')
  assert.equal(blockOf(cleared, 'button'), '')
  assert.equal(cleared.includes('ui-kit:button'), false)
})

test('an element starts from the kit rules that style its classes', () => {
  const rules = rulesOf(BASE_CSS, ['ui-button'])
  assert.ok(rules.includes('.ui-button {'), 'the base rule')
  assert.ok(rules.includes('.ui-button[data-kind="primary"]'), 'a variant')
  assert.ok(rules.includes('\n  cursor: pointer;\n'), 'each declaration on its own line')
  assert.equal(rules.includes('.ui-buttonish'), false)
  assert.equal(rulesOf(BASE_CSS, ['ui-badge']).includes('.ui-slot-count'), false)
})

test('every element renders with its defaults and uses a class it declares', () => {
  for (const entry of ELEMENTS) {
    const html = entry.sample(kit, defaultsOf(entry))
    assert.ok(html.length > 0, `${entry.id} has markup`)
    assert.ok(entry.classes.some(name => html.includes(name)), `${entry.id} carries one of its classes`)
    assert.ok(rulesOf(BASE_CSS, entry.classes).length > 0, `${entry.id} has kit rules to start from`)
  }
})

test('the commands save and read one element through the game files', async () => {
  const files = { 'assets/ui/theme.css': ':root { --ui-accent: #f06 }' }
  const context = {
    files: { read: async path => files[path] ?? '', write: async (path, text) => { files[path] = text } },
    gameUi: { theme: { sheet: css => BASE_CSS + css } },
    redraw() {}
  }
  const run = id => panelUiKit.commands.find(command => command.id === id).run
  assert.equal((await run('uikit.css')(context, 'button')).isSaved, false)
  await run('uikit.set')(context, { element: 'button', css: '.ui-button { color: red }' })
  const saved = await run('uikit.css')(context, { element: 'button' })
  assert.deepEqual([saved.isSaved, saved.css], [true, '.ui-button { color: red }'])
  assert.ok(files['assets/ui/theme.css'].includes('--ui-accent: #f06'), 'the game keeps its tokens')
  await assert.rejects(run('uikit.css')(context, 'nope'), /no UI kit element/)
})
