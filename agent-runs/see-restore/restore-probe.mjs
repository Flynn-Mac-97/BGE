/**
 * The restore probe: every See error path, and the state it left behind.
 *
 * An image command borrows the world to get its picture — it spawns a preview,
 * moves the camera, hides the other entities, takes the post-processing chain
 * away, steps the clock. The paths that FINISH are easy to put back. The paths
 * that refuse, and the paths that throw, are the ones that leave an editor
 * staring down a borrowed lens at a world with its lights off.
 *
 * So: for each failing call, `snapshot({entities:true})` and `see.camera`
 * before, the call, then both again. An empty diff is the pass. Every case runs
 * in a world of its own — one `--headless` process each, no dev server, no
 * browser, no shared state to confuse one case with the next.
 *
 *   node agent-runs/see-restore/restore-probe.mjs
 */
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const PROJECT = 'kitten-survivors'

/** A held clock, deterministically: ending the run holds it under `run-over`. */
const HOLD_THE_CLOCK = ['run', 'run.end', 'probe']

const CASES = [
  {
    name: 'capture / not drawing',
    why: 'headless there is no renderer at all, which is the same refusal a hidden tab gets after its readback comes back empty',
    call: ['run', 'see.capture', {}]
  },
  {
    name: 'capture / unknown subject',
    why: 'a name that is neither an entity id nor a type',
    call: ['run', 'see.capture', { subject: 'not-a-thing' }]
  },
  {
    name: 'capture / empty studio',
    why: 'alone on a subject the camera is not pointing at',
    call: ['run', 'see.capture', { subject: 'you', alone: true, camera: { x: 9999, y: 9999, z: 9999 } }]
  },
  {
    name: 'capture / preview of a type',
    why: 'a type with no live instance is spawned, framed and destroyed',
    call: ['run', 'see.capture', { subject: 'boar' }]
  },
  {
    name: 'capture / no such saved view',
    why: 'a view name that was never saved',
    call: ['run', 'see.capture', { view: 'no-such-view' }]
  },
  {
    name: 'sketch / unknown subject',
    why: 'the same refusal, on the path that reaches the preview code headless',
    call: ['run', 'see.sketch', { subject: 'not-a-thing' }]
  },
  {
    name: 'sketch / preview of a type',
    why: 'the real spawn-and-destroy, run headless: the entity must be gone and the id counter untouched',
    call: ['run', 'see.sketch', { subject: 'boar', name: 'restore-probe-boar' }]
  },
  {
    name: 'sketch / empty studio',
    why: 'alone on a subject outside the frame',
    call: ['run', 'see.sketch', { subject: 'you', alone: true, camera: { x: 9999, y: 9999, z: 9999 } }]
  },
  {
    name: 'sketch / no such saved view',
    why: 'a view name that was never saved',
    call: ['run', 'see.sketch', { view: 'no-such-view' }]
  },
  {
    name: 'moment / no renderer',
    why: 'headless refusal, before any step is taken',
    call: ['run', 'see.moment', { steps: [0, 6, 30] }]
  },
  {
    name: 'moment / held clock',
    why: 'asked to step while something holds time',
    setup: [['simulate', 2], HOLD_THE_CLOCK],
    call: ['run', 'see.moment', { steps: [0, 6, 30] }]
  },
  {
    name: 'diff / held clock',
    why: 'asked to step while something holds time',
    setup: [['simulate', 2], HOLD_THE_CLOCK],
    call: ['run', 'see.diff', { steps: 30 }]
  },
  {
    name: 'diff / held clock, world never simulated',
    why: 'the same refusal on an unplayed level, where starting the hooks would move every entity off its edited place',
    setup: [HOLD_THE_CLOCK],
    call: ['run', 'see.diff', { steps: 30 }]
  },
  {
    name: 'isolate / held clock',
    why: 'the velocity step cannot pass, so the dossier must not step at all',
    setup: [['simulate', 2], HOLD_THE_CLOCK],
    call: ['run', 'see.isolate', { subject: 'you' }]
  },
  {
    name: 'view / aim at nothing',
    why: 'the live camera must not move for a name that does not exist',
    call: ['run', 'see.view', { aim: 'not-a-thing' }]
  }
]

const READ = [['snapshot', { entities: true }], ['run', 'see.camera']]

function runScript(steps) {
  const out = execFileSync(process.execPath,
    ['bin/engine.mjs', '--headless', '--project', PROJECT, 'script', JSON.stringify(steps)],
    { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 28 })
  return JSON.parse(out)
}

/**
 * Every place two values disagree, named by path. Entity lists are matched by
 * id rather than by position, because "everything after index 40 moved up one"
 * is one destroyed entity, not four hundred changes.
 */
function differences(before, after, path = '', found = []) {
  if (found.length > 40) return found
  if (Object.is(before, after)) return found
  if (Array.isArray(before) && Array.isArray(after) && before.every(item => item?.id)) {
    const byId = list => new Map(list.map(item => [item.id, item]))
    const [was, is] = [byId(before), byId(after)]
    for (const [id, item] of was) {
      if (!is.has(id)) found.push({ at: `${path}[${id}]`, before: item, after: 'gone' })
      else differences(item, is.get(id), `${path}[${id}]`, found)
    }
    for (const [id, item] of is) if (!was.has(id)) found.push({ at: `${path}[${id}]`, before: 'absent', after: item })
    return found
  }
  const object = value => value && typeof value === 'object'
  if (!object(before) || !object(after) || Array.isArray(before) !== Array.isArray(after)) {
    if (JSON.stringify(before) !== JSON.stringify(after)) found.push({ at: path || '(root)', before, after })
    return found
  }
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    differences(before[key], after[key], path ? `${path}.${key}` : key, found)
  }
  return found
}

const short = value => {
  const text = JSON.stringify(value)
  return text.length > 220 ? text.slice(0, 217) + '...' : text
}

let leaked = 0
for (const probe of CASES) {
  const steps = [...(probe.setup || []), ...READ, probe.call, ...READ]
  let results
  try {
    results = runScript(steps)
  } catch (error) {
    console.log(`\n${probe.name}\n  FAILED TO RUN — ${String(error.stderr || error.message).trim().split('\n').slice(-3).join(' ')}`)
    leaked++
    continue
  }
  const [snapBefore, cameraBefore] = results.slice(-5, -3)
  const reply = results[results.length - 3]
  const [snapAfter, cameraAfter] = results.slice(-2)
  const diff = [
    ...differences(snapBefore, snapAfter, 'snapshot'),
    ...differences(cameraBefore, cameraAfter, 'see.camera')
  ]
  if (diff.length) leaked++
  console.log(`\n${probe.name}`)
  console.log(`  ${probe.why}`)
  console.log(`  call    ${JSON.stringify(probe.call)}`)
  console.log(`  reply   ${short(reply)}`)
  console.log(`  diff    ${diff.length ? `${diff.length} LEAKED` : 'empty'}`)
  for (const entry of diff) console.log(`    ${entry.at}: ${short(entry.before)} -> ${short(entry.after)}`)
}

console.log(`\n${CASES.length - leaked}/${CASES.length} error paths left the world exactly as they found it.`)
process.exit(leaked ? 1 : 0)
