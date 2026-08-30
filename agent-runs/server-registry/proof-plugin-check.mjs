#!/usr/bin/env node
/**
 * Proof: `engine check` catches a plugin that will not import.
 *
 * A failed plugin import used to be silent — every command in the file vanished
 * and the only symptom was `no command "see.capture"`. This breaks real plugin
 * files one at a time, runs `check`, and records the exact output and exit code.
 *
 * Every file is restored in a `finally`, and the run ends by asking git whether
 * anything is still modified — a proof that leaves a broken plugin on disk would
 * be worse than no proof at all.
 *
 *   node agent-runs/server-registry/proof-plugin-check.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { pluginImportFailures } from '../../engine/project-index.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const CLI = path.join(ROOT, 'bin/engine.mjs')
const REPORT = path.join(ROOT, 'agent-runs/server-registry/plugin-check-proof.txt')

const lines = []
const say = text => { lines.push(text); process.stdout.write(text + '\n') }

const check = () => {
  try {
    const stdout = execFileSync(process.execPath, [CLI, 'check', '--raw'],
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    return { code: 0, stdout }
  } catch (error) {
    return { code: error.status ?? -1, stdout: error.stdout || '', stderr: error.stderr || '' }
  }
}

const SEE = 'plugins/builtin/see.js'
const WEAPONS = 'project/plugins/weapons.js'
const original = new Map()

const breakFile = (relative, text) => {
  const file = path.join(ROOT, relative)
  if (!original.has(relative)) original.set(relative, fs.readFileSync(file, 'utf8'))
  fs.writeFileSync(file, text, 'utf8')
}

const restore = () => {
  for (const [relative, text] of original) fs.writeFileSync(path.join(ROOT, relative), text, 'utf8')
  original.clear()
}

const report = (title, result) => {
  say('')
  say(`### ${title}`)
  say(`$ node bin/engine.mjs check --raw`)
  say(result.stdout.trim() || '(no output)')
  say(`exit code: ${result.code}`)
}

let failures = 0
const expect = (claim, ok) => {
  say(`${ok ? 'PASS' : 'FAIL'}  ${claim}`)
  if (!ok) failures++
}

try {
  say('proof: a plugin that will not import fails `check` by name')
  say(`checkout: ${ROOT}`)

  const healthy = check()
  report('healthy tree', healthy)
  expect('a healthy tree exits 0 with no problems', healthy.code === 0 && JSON.parse(healthy.stdout).problems.length === 0)

  // A syntax error in a builtin plugin. This is the exact shape of the failure
  // the trap describes: the file is never parsed, so every command in it is gone.
  breakFile(SEE, "export default {\n  name: 'See',\n  commands: [ // deliberately unclosed for this proof\n")
  const syntax = check()
  report('plugins/builtin/see.js has a syntax error', syntax)
  const syntaxProblems = JSON.parse(syntax.stdout).problems
  expect('exits 1', syntax.code === 1)
  expect('names the plugin file', syntaxProblems.some(p => p.file === SEE))
  expect('names the error', syntaxProblems.some(p => /failed to import/.test(p.why)))
  expect('gives the line', syntaxProblems.some(p => p.file === SEE && Number.isFinite(p.line)))
  restore()

  // A throw at module scope in a project plugin. Same silence, different cause,
  // and the project's own plugins have to be covered as well as the builtins.
  breakFile(WEAPONS, "throw new Error('this plugin cannot start')\nexport default { name: 'Weapons' }\n")
  const thrown = check()
  report('project/plugins/weapons.js throws while loading', thrown)
  expect('exits 1', thrown.code === 1)
  expect('names the project plugin and its error',
    JSON.parse(thrown.stdout).problems.some(p => p.file === WEAPONS && /this plugin cannot start/.test(p.why)))
  restore()

  // A file with no default export is skipped by the loader without a word, so
  // its commands are missing just as completely as a file that threw.
  breakFile(SEE, "export const helper = () => 1\n")
  const noDefault = check()
  report('plugins/builtin/see.js exports no default', noDefault)
  expect('exits 1 and says the loader skips it',
    noDefault.code === 1 && JSON.parse(noDefault.stdout).problems.some(p => p.file === SEE && /no default export/.test(p.why)))
  restore()

  // Two broken plugins at once. One failure must not hide the next, and the
  // rest of the project must still be checked around them.
  breakFile(SEE, "export default { name: 'See', (\n")
  breakFile(WEAPONS, "throw new Error('weapons is broken too')\n")
  const both = check()
  report('two plugins broken at once', both)
  const bothProblems = JSON.parse(both.stdout).problems
  expect('both are reported', bothProblems.some(p => p.file === SEE) && bothProblems.some(p => p.file === WEAPONS))
  restore()

  // A broken plugin must not stop the project itself being checked, or fixing
  // the plugin would reveal a second problem nobody had been told about.
  breakFile(SEE, "export default { name: 'See', (\n")
  fs.writeFileSync(path.join(ROOT, 'project/levels/proof-broken.json'), '{ this is not json', 'utf8')
  const alongside = check()
  report('a broken plugin beside a broken level', alongside)
  const alongsideProblems = JSON.parse(alongside.stdout).problems
  expect('the plugin and the level are both reported',
    alongsideProblems.some(p => p.file === SEE) && alongsideProblems.some(p => /proof-broken/.test(p.file)))
  fs.rmSync(path.join(ROOT, 'project/levels/proof-broken.json'), { force: true })
  restore()

  // The raw finding, in the shape a running loader reports its own failures in.
  // `check` turns this into its problem list; pointing it at a live loader's
  // list instead would change nothing else.
  breakFile(SEE, "export default { name: 'See', (\n")
  const raw = await pluginImportFailures(ROOT, path.join(ROOT, 'project'))
  say('')
  say('### the failure record itself, before check words it')
  say(JSON.stringify(raw, null, 2))
  expect('the record carries name, file, error, builtin and failedToImport',
    raw.length === 1 && raw[0].name === null && raw[0].file === SEE && raw[0].builtin === true && raw[0].failedToImport === true && typeof raw[0].error === 'string')
  restore()

  const again = check()
  report('restored tree', again)
  expect('the tree is clean again', again.code === 0 && JSON.parse(again.stdout).problems.length === 0)
} finally {
  restore()
  fs.rmSync(path.join(ROOT, 'project/levels/proof-broken.json'), { force: true })
  const dirty = execFileSync('git', ['-C', ROOT, 'status', '--porcelain', '--', SEE, WEAPONS, 'project/levels'],
    { encoding: 'utf8' }).trim()
  say('')
  say(`git status of the files this proof touched: ${dirty || '(clean)'}`)
  if (dirty) failures++
  fs.mkdirSync(path.dirname(REPORT), { recursive: true })
  fs.writeFileSync(REPORT, lines.join('\n') + '\n', 'utf8')
}

say('')
say(failures ? `${failures} check(s) failed` : 'every check passed')
process.exit(failures ? 1 : 0)
