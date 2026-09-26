#!/usr/bin/env node
/**
 * A plugin guide's `match:` paths decide which packets carry it. A path the
 * reader keeps with a comma on its end matches no file, so the guide drops out
 * of every packet built from files, and nothing says so.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pluginGuides } from '../engine/plugin-guides.mjs'

test('match paths split on commas as well as spaces', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'guide-match-'))
  await fs.mkdir(path.join(root, 'plugins/builtin'), { recursive: true })
  await fs.writeFile(
    path.join(root, 'plugins/builtin/sample.agent.md'),
    '---\nmatch: tools/one.mjs, tools/two.mjs tools/lib/*.mjs\n---\n# Sample\n'
  )
  const [guide] = await pluginGuides(root, path.join(root, 'no-project'))
  assert.deepEqual(guide.match, ['plugins/builtin/sample.js', 'tools/one.mjs', 'tools/two.mjs', 'tools/lib/*.mjs'])
  await fs.rm(root, { recursive: true, force: true })
})
