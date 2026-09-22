import test from 'node:test'
import assert from 'node:assert/strict'
import see from '../plugins/builtin/see.js'
import { validateCommandInput } from '../engine/command-schema.js'

const editorSchema = see.commands.find(command => command.id === 'see.editor').inputSchema

test('see.editor accepts names its declared pattern allows, and an omitted name', () => {
  validateCommandInput(editorSchema, { name: 'desktop-test' })
  validateCommandInput(editorSchema, { scope: 'editor', name: 'Capture_01' })
  validateCommandInput(editorSchema, {})
})

test('see.editor rejects a mismatched name at the argument path', () => {
  for (const name of ['../loot', 'a/b', 'name with space', 'CAFÉ']) {
    assert.throws(() => validateCommandInput(editorSchema, { name }), /args\.name: does not match pattern/)
  }
})

test('type validation runs before the pattern', () => {
  assert.throws(() => validateCommandInput(editorSchema, { name: 7 }), /args\.name: expected string/)
})

test('a pattern is unanchored unless the schema anchors it', () => {
  validateCommandInput({ type: 'string', pattern: '[0-9]+' }, 'abc123')
  assert.throws(() => validateCommandInput({ type: 'string', pattern: '^[a-z]+$' }, 'abc1'), /args: does not match pattern/)
})

test('pattern applies only to strings', () => {
  validateCommandInput({ pattern: '^yes$' }, 42)
})

test('a malformed pattern is reported as a schema defect, not tested', () => {
  assert.throws(() => validateCommandInput({ type: 'string', pattern: '[' }, 'anything'), /args: invalid schema pattern "\["/)
})

test('a non-string pattern is refused rather than coerced', () => {
  assert.throws(() => validateCommandInput({ type: 'string', pattern: 7 }, '7'), /args: schema pattern must be a string/)
})

test('unrelated unsupported keywords stay rejected', () => {
  assert.throws(() => validateCommandInput({ type: 'string', format: 'email' }, 'a@b'), /args: unsupported schema keyword format/)
})
