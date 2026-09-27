#!/usr/bin/env node
/**
 * Deleting a Kimodo take. Stored motion removed while another clip still
 * names it breaks that clip's regeneration later, and nothing says so then.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { deleteTake } from '../plugins/builtin/kimodo/take-files.mjs'

/** A project with `clips`, each `{ clip, from }`, and each named source directory made. */
function projectWith(clips) {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'kimodo-takes-'))
  for (const { clip, from } of clips) {
    fs.mkdirSync(path.dirname(path.join(project, 'assets', clip)), { recursive: true })
    fs.writeFileSync(path.join(project, 'assets', clip), JSON.stringify({ source: { from } }))
    fs.mkdirSync(path.join(project, from), { recursive: true })
  }
  return project
}

test('a take goes with its stored motion', () => {
  const project = projectWith([{ clip: 'motion/hero/take-a.json', from: 'assets/motion/source/take-a' }])
  assert.deepEqual(deleteTake(project, 'motion/hero/take-a.json').deleted, [
    'assets/motion/hero/take-a.json',
    'assets/motion/source/take-a'
  ])
  assert.equal(fs.existsSync(path.join(project, 'assets/motion/source/take-a')), false)
})

test('stored motion another clip names is kept', () => {
  const from = 'assets/motion/source/take-a'
  const project = projectWith([
    { clip: 'motion/hero/take-a.json', from },
    { clip: 'motion/villain/take-a.json', from }
  ])
  assert.deepEqual(deleteTake(project, 'motion/hero/take-a.json').deleted, ['assets/motion/hero/take-a.json'])
  assert.ok(fs.existsSync(path.join(project, from)))
})

test('a path that is not a take is refused', () => {
  assert.throws(() => deleteTake(os.tmpdir(), '../../etc/passwd'), /is not a take/)
})
