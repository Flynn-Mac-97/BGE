/**
 * The command-input boundary: the schema subset the engine checks before a
 * handler runs.
 *
 * A plugin declares `inputSchema` and the engine checks it at `engine.run`, so a
 * bad argument is refused by name rather than reaching a handler that assumed it
 * was well formed. The schema below is the one `see.editor` declares, copied
 * here so the kernel's suite never imports a plugin.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { validateCommandInput } from '../../../engine/command-schema.js'

const editorSchema = {
  type: 'object',
  properties: {
    scope: { type: 'string', enum: ['editor', 'window'] },
    name: { type: 'string', pattern: '^[a-zA-Z0-9_-]+$' }
  },
  additionalProperties: false
}

test('a declared name is accepted, and a name may be left out', () => {
  validateCommandInput(editorSchema, { name: 'desktop-test' })
  validateCommandInput(editorSchema, { scope: 'editor', name: 'Capture_01' })
  validateCommandInput(editorSchema, {})
})

test('a name outside the declared pattern is refused at the argument path', () => {
  for (const name of ['../loot', 'a/b', 'name with space', 'CAFÉ']) {
    assert.throws(() => validateCommandInput(editorSchema, { name }), /args\.name: does not match pattern/)
  }
})

test('an argument the schema does not declare is refused', () => {
  assert.throws(() => validateCommandInput(editorSchema, { typo: true }), /args\.typo: unknown argument/)
})

test('an enum value outside the list is refused by the list', () => {
  assert.throws(() => validateCommandInput(editorSchema, { scope: 'elsewhere' }), /expected one of editor, window/)
})

test('type validation runs before the pattern', () => {
  assert.throws(() => validateCommandInput(editorSchema, { name: 7 }), /args\.name: expected string/)
})

test('a pattern is unanchored unless the schema anchors it', () => {
  validateCommandInput({ type: 'string', pattern: '[0-9]+' }, 'abc123')
  assert.throws(() => validateCommandInput({ type: 'string', pattern: '^[a-z]+$' }, 'abc1'), /args: does not match pattern/)
})

test('a pattern applies only to strings', () => {
  validateCommandInput({ pattern: '^yes$' }, 42)
})

test('a malformed pattern is reported as a schema defect, not tested against the value', () => {
  assert.throws(() => validateCommandInput({ type: 'string', pattern: '[' }, 'anything'), /args: invalid schema pattern "\["/)
})

test('a non-string pattern is refused rather than coerced', () => {
  assert.throws(() => validateCommandInput({ type: 'string', pattern: 7 }, '7'), /args: schema pattern must be a string/)
})

test('a keyword outside the subset is refused by name', () => {
  assert.throws(() => validateCommandInput({ type: 'string', format: 'email' }, 'a@b'), /args: unsupported schema keyword format/)
})
