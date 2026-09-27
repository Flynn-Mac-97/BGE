#!/usr/bin/env node
/**
 * Kimodo prompt advice: a prompt in NVIDIA's trained style gets none, and each
 * way a real take's prompt went wrong gets the line that says what to change.
 *
 *   node --test test/prompt-advice.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { promptAdvice } from '../tools/lib/prompt-advice.mjs'

test('a mid-detail prompt that starts with the subject gets no advice', () => {
  assert.deepEqual(promptAdvice('A person slashes hard with a sword', 2), [])
  assert.deepEqual(promptAdvice('a tired person walks forward', 4), [])
})

test('each broken rule says what to change', () => {
  const advice = (prompt, seconds = 2) => promptAdvice(prompt, seconds).join(' | ')
  assert.match(advice('man holds greatsword with two hands'), /start with "A person/)
  assert.match(advice('a person draws a sword and raises it up and forward'), /several actions/)
  assert.match(advice('a person raises the right arm with the hand open'), /body parts one by one/)
  assert.match(advice('a person runs forward carrying a heavy load'), /"wearing"/)
  assert.match(advice('a person walks', 12), /over 10 seconds/)
})
