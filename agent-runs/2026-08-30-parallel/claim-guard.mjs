/**
 * The claim guard, against the failure p25 described.
 *
 * One run claims a file; a second writer is refused by name instead of winning
 * silently. Proves the guard is real, that a run does not refuse itself, and
 * that turning the plugin off opens writes again.
 *
 *   node agent-runs/2026-08-30-parallel/claim-guard.mjs
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { prepareAgent, releaseAgent } from '../../engine/agent-workspace-node.mjs'
import { startWorldInNode } from '../../engine/start-world-node.mjs'

const ROOT = 'Z:/Code/browser game engine'
const ID = 'probe-claim'
const REGISTRY = join(ROOT, 'project/.engine/agents.json')
const GAME = join(ROOT, 'project/game.json')
const gameBefore = readFileSync(GAME, 'utf8')

let failures = 0
const check = (ok, label, detail) => {
  console.log(ok ? 'ok  ' : 'FAIL', label)
  if (!ok) { failures++; if (detail !== undefined) console.log('     ', JSON.stringify(detail)) }
}

const wrote = async (context, path) => {
  try { await context.files.write(path, '// probe\n'); return null } catch (error) { return String(error.message) }
}

try {
  rmSync(REGISTRY, { force: true })
  await prepareAgent(ROOT, ID, { task: 'hold a level', files: ['project/levels/probe-claim.json'] })

  // ---- a second writer is refused ------------------------------------------
  delete process.env.ENGINE_AGENT_ID
  const { context } = await startWorldInNode({ root: ROOT })
  const refused = await wrote(context, 'levels/probe-claim.json')
  check(refused !== null, 'a claimed file is refused')
  check(/claimed it/.test(refused || ''), 'and the refusal names the run', refused)
  check(/probe-claim/.test(refused || ''), 'by its id')

  // ---- an unclaimed file still writes --------------------------------------
  const allowed = await wrote(context, 'levels/probe-unclaimed.json')
  check(allowed === null, 'an unclaimed file still writes', allowed)
  rmSync(join(ROOT, 'project/levels/probe-unclaimed.json'), { force: true })

  // ---- the run does not refuse itself --------------------------------------
  process.env.ENGINE_AGENT_ID = ID
  const { context: mine } = await startWorldInNode({ root: ROOT })
  const own = await wrote(mine, 'levels/probe-claim.json')
  check(own === null, 'the claiming run writes its own file', own)
  rmSync(join(ROOT, 'project/levels/probe-claim.json'), { force: true })

  // ---- switching the plugin off opens writes again -------------------------
  delete process.env.ENGINE_AGENT_ID
  const game = JSON.parse(gameBefore)
  game.plugins = { ...(game.plugins || {}), disabled: [...(game.plugins?.disabled || []), 'Claim Guard'] }
  writeFileSync(GAME, JSON.stringify(game, null, 2))
  const { context: off } = await startWorldInNode({ root: ROOT })
  const openAgain = await wrote(off, 'levels/probe-claim.json')
  check(openAgain === null, 'disabling the plugin opens writes again', openAgain)
  rmSync(join(ROOT, 'project/levels/probe-claim.json'), { force: true })
} finally {
  writeFileSync(GAME, gameBefore)
  try { releaseAgent(ROOT, ID, { status: 'blocked', note: 'probe' }) } catch { /* already gone */ }
  rmSync(REGISTRY, { force: true })
  rmSync(join(ROOT, 'project/levels/probe-claim.json'), { force: true })
  rmSync(join(ROOT, 'project/levels/probe-unclaimed.json'), { force: true })
  execFileSync('git', ['-C', ROOT, 'checkout', '--', 'project/game.json'], { stdio: 'ignore' })
  console.log('registry, probe levels and game.json restored')
}

console.log(failures ? `\n${failures} FAILED` : '\nall clear')
process.exit(failures ? 1 : 0)
