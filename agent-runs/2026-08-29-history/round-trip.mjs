/**
 * Prove the History plugin round trips in a real headless world.
 *
 * Move an entity the way the editor moves one, show the step was recorded, step
 * back, then show the world and the level file are both back where they started.
 * The level file is restored at the end whatever happens, because this runs
 * against the real project.
 *
 * Every save is awaited. The editor fires them and forgets, and two overlapping
 * index writes in one process race on the same temp file — a pre-existing engine
 * fault, logged as a painpoint, nothing to do with the palette.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { startWorldInNode } from '../../engine/start-world-node.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const LEVEL = path.join(ROOT, 'project/levels/level1.json')

const say = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}` +
    (ok ? '' : `\n     got  ${JSON.stringify(got)}\n     want ${JSON.stringify(want)}`))
  if (!ok) process.exitCode = 1
}

const before = await fs.readFile(LEVEL, 'utf8')

try {
  const { engine, editor, world, context, loop } = await startWorldInNode({ root: ROOT })
  await editor.loadLevel('level1')

  const listed = () => engine.run('history.list')
  const labels = () => listed().entries.map(entry => entry.label)
  const target = world.entities[1]
  const startX = target.x

  say('one baseline entry after a load', labels(), ['Opened level1'])

  // The Inspector's path: write the field, say so, save.
  const setField = async (key, value) => {
    world.byId(target.id)[key] = value
    context.bus.emit('world:changed')
    await context.save()
  }
  // The Transform Tool's path: mutate and save, announcing nothing at all.
  const nudge = async value => {
    world.byId(target.id).x = value
    await context.save()
  }

  await setField('x', startX + 3)
  say('the move was recorded', labels(), ['Opened level1', `Moved ${target.id}`])
  say('the world moved', world.byId(target.id).x, startX + 3)

  // A nudge announces nothing but the write, so this is the files:written path.
  for (let n = 1; n <= 30; n++) await nudge(startX + 3 + n * 0.5)
  say('thirty silent nudges were seen', world.byId(target.id).x, startX + 18)
  say('and stayed one entry', labels(), ['Opened level1', `Moved ${target.id}`])

  const undone = await engine.run('history.undo')
  say('undo landed on the baseline', [undone.at, undone.label], [0, 'Opened level1'])
  say('the world is back', world.byId(target.id).x, startX)
  say('the entity kept its id', world.entities.map(entity => entity.id).includes(target.id), true)
  say('nothing else moved', world.entities.length, JSON.parse(before).entities.length)
  say('the forward step is still listed', listed().entries.filter(entry => entry.undone).length, 1)

  const after = JSON.parse(await fs.readFile(LEVEL, 'utf8'))
  say('the level on disk is back', after.entities, JSON.parse(before).entities)

  const redone = await engine.run('history.redo')
  say('redo goes forward again', [redone.at, redone.label], [1, `Moved ${target.id}`])
  say('the world moved again', world.byId(target.id).x, startX + 18)

  say('nothing further forward', (await engine.run('history.redo')).skipped, 'at the newest step')

  // Stepping back and then changing something drops the forward entries.
  await engine.run('history.undo')
  await setField('y', world.byId(target.id).y + 1)
  say('a change after stepping back truncates', labels(), ['Opened level1', `Moved ${target.id}`])
  say('and it is the new change', world.byId(target.id).x, startX)

  // Deleting is a step too.
  const spare = world.entities[2]
  context.destroy(spare)
  await context.save()
  say('a delete is recorded', labels().at(-1), `Deleted ${spare.id}`)
  await engine.run('history.undo')
  say('undo brings it back', !!world.byId(spare.id), true)

  // loop.running is what play sets and what the guard reads.
  loop.start()
  const blocked = await engine.run('history.undo')
  loop.stop()
  say('undo refuses while playing', blocked.skipped, 'playing')

  say('the palette is untouched by the refusal', [listed().current, labels().length], [1, 3])
} catch (error) {
  process.exitCode = 1
  console.log('THREW', error?.stack || error)
} finally {
  await fs.writeFile(LEVEL, before, 'utf8')
  console.log('level1.json restored')
}

process.exit(process.exitCode || 0)
