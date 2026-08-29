/**
 * The play guard, proved against the sequence that broke it.
 *
 * `play:started` fires and every `start` hook runs BEFORE the loop starts, and
 * `world.simulated` is only set on the first fixed step — so for the whole
 * start-hook phase both of the obvious guards read false. A type whose `start`
 * spawns filed one entry per spawn, and stopping filed the mass delete: a dozen
 * play cycles evicted every real edit, and jumping onto one of those entries
 * wrote runtime entities over the level file.
 *
 *   node agent-runs/2026-08-29-history/play-guard.mjs
 */
import { readFileSync, writeFileSync, rmSync } from 'node:fs'
import { startWorldInNode } from '../../engine/start-world-node.mjs'

const ROOT = 'Z:/Code/browser game engine'
const LEVEL = `${ROOT}/project/levels/level1.json`
const TYPE = `${ROOT}/project/types/probe-spawner.js`
const before = readFileSync(LEVEL, 'utf8')

let failures = 0
const check = (ok, label, got) => {
  console.log(ok ? 'ok  ' : 'FAIL', label)
  if (!ok) { failures++; if (got !== undefined) console.log('     got', JSON.stringify(got)) }
}

// A type whose start hook spawns. This is the shape that broke the guard.
writeFileSync(TYPE, `export default {
  properties: { spawned: 0 },
  start(entity, context) {
    for (let index = 0; index < 3; index++) context.spawn('coin', { at: [index, 5, 0] })
  }
}
`)

try {
  // Name the level. A headless world opens whatever game.json calls the start
  // level, which is de_dust2 here — spawning into "the open level" without
  // saying which one wrote probes into the Counter-Strike map and left `check`
  // failing on a file this script never meant to touch.
  const { context, engine, editor } = await startWorldInNode({ root: ROOT })
  await editor.loadLevel('level1')
  await engine.run('history.clear')
  context.spawn('probe-spawner', { at: [2, 2, 0] })
  await context.save()

  const listed = () => engine.run('history.list')
  const labels = () => listed().entries.map(entry => entry.label)

  const beforePlay = labels()
  check(beforePlay.some(label => label.startsWith('Added')), 'the real edit was recorded', beforePlay)

  engine.play()
  const duringPlay = labels()
  check(duringPlay.length === beforePlay.length,
    'play added no entries — the start hook spawned three and none were filed', duringPlay)

  engine.stop()
  const afterStop = labels()
  check(!afterStop.some(label => label.startsWith('Deleted')),
    'stopping filed no mass delete', afterStop)

  // simulate() runs start hooks the same way, with the loop stopped.
  const { context: second, engine: twice, editor: alsoEditor } = await startWorldInNode({ root: ROOT })
  await alsoEditor.loadLevel('level1')
  await twice.run('history.clear')
  second.spawn('probe-spawner', { at: [3, 2, 0] })
  await second.save()
  const beforeSimulate = twice.run('history.list').entries.length
  twice.simulate(0.5)
  const afterSimulate = twice.run('history.list').entries.length
  check(afterSimulate === beforeSimulate,
    'simulate added no entries either', { beforeSimulate, afterSimulate })

  check(twice.run('history.undo').skipped === undefined || second.world.simulated,
    'a simulated world does not pretend it can step back')
} finally {
  rmSync(TYPE, { force: true })
  writeFileSync(LEVEL, before)
  console.log('level1.json restored')
}

console.log(failures ? `\n${failures} FAILED` : '\nall clear')
process.exit(failures ? 1 : 0)
