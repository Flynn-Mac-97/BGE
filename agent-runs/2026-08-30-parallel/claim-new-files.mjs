/**
 * Four lanes each adding one new plugin to one folder is the ordinary case.
 *
 * p63: a claim on `<project>/plugins` locked every other lane out of the whole
 * folder, including files nobody had written yet. A claim exists so two writers
 * never edit one file; a file that does not exist cannot be edited twice, and
 * each lane is in its own worktree.
 *
 * Against a temporary directory rather than the checkout, deliberately: the
 * real registry has live lanes in it, and a proof that has to reset the repo to
 * clean up is a proof that can destroy the work it was run to protect.
 *
 *   node agent-runs/2026-08-30-parallel/claim-new-files.mjs
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { claimsCollide, claimsOverlap } from '../../engine/agent-workspace-node.mjs'

let failures = 0
const check = (ok, label, detail) => {
  console.log(ok ? 'ok  ' : 'FAIL', label)
  if (!ok) { failures++; if (detail !== undefined) console.log('     ', JSON.stringify(detail)) }
}

const root = mkdtempSync(join(tmpdir(), 'claim-'))
try {
  mkdirSync(join(root, 'game/plugins'), { recursive: true })
  writeFileSync(join(root, 'game/plugins/already-here.js'), 'export default {}\n')

  const folder = 'game/plugins'

  check(claimsCollide(root, folder, folder) === true,
    'the same claim twice is a conflict')
  check(claimsCollide(root, 'game/plugins/already-here.js', folder) === true,
    'a file already in a claimed folder is a conflict')
  check(claimsCollide(root, 'game/plugins/not-written-yet.js', folder) === false,
    'a file that does not exist yet is not')
  check(claimsCollide(root, 'game/plugins/not-written-yet.js', 'game/plugins/not-written-yet.js') === true,
    'but two lanes meaning to create the same file are')
  check(claimsCollide(root, 'game/types/kitten.js', folder) === false,
    'and an unrelated path never was')

  // The prefix rule itself is unchanged — it is the question being asked that
  // changed, so the exported matcher must still answer the old one.
  check(claimsOverlap('game/plugins/not-written-yet.js', folder) === true,
    'claimsOverlap still reports the prefix relation')
} finally {
  rmSync(root, { recursive: true, force: true })
  console.log('temporary checkout removed')
}

console.log(failures ? `\n${failures} FAILED` : '\nall clear')
process.exit(failures ? 1 : 0)
