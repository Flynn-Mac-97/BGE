/**
 * The project engine tests open.
 *
 * A real project on disk, small on purpose: the index build, the plugin load
 * and the level load are all exercised for real, and none of it depends on a
 * game. The engine repository holds no game, so a test that reached for one
 * would fail on a fresh clone.
 *
 * A test needing a variant — a declared device, a broken type, a second level —
 * calls `temporaryProject`. `FIXTURE` itself never changes to suit one test,
 * because several read it.
 */
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const CHECKOUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** The fixture project, as the path `--project` and `startWorldInNode` take. */
export const FIXTURE = path.join(CHECKOUT, 'test/fixture-project')

/** The level `FIXTURE` opens: three ground tiles, a player, three props, two spinners. */
export const FIXTURE_LEVEL = 'main'

/**
 * A writable copy of the fixture.
 *
 * `FIXTURE` is committed and several tests read it, and an editing verb saves
 * the level straight to disk. A test that spawns, sets or destroys must open a
 * copy, or it edits the fixture every other test reads.
 */
export async function temporaryFixture(name = 'engine-fixture-copy-') {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), name))
  await fs.cp(FIXTURE, directory, { recursive: true, filter: source => !source.includes('.engine') })
  return directory
}

/**
 * A project of your own, written to a temporary directory.
 *
 * `files` is a map of project-relative path to text; an object is written as
 * JSON. The directory is returned, and the caller removes it.
 */
export async function temporaryProject(files = {}, name = 'engine-fixture-') {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), name))
  for (const [file, value] of Object.entries(files)) {
    const target = path.join(directory, file)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n', 'utf8')
  }
  return directory
}
