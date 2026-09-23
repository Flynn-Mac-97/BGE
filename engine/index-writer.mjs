/**
 * Write the generated index and agent view beside a project.
 *
 * Split from `project-index.mjs`: building the index and writing its generated
 * files change for different reasons. The builder stays in `project-index.mjs`
 * and calls `writeIndexFiles` at the end; nothing else writes these files.
 *
 * Node only: it writes to disk.
 */
import fs from 'node:fs/promises'
import path from 'node:path'

/**
 * What the agent view keeps of each record kind, and in the order it writes it.
 *
 * The fields are named here rather than copied one by one, so the shape of a
 * record lives in one place: the entry built in `project-index.mjs`. `always` names
 * agent must see even when they are empty, because "none" and "not asked" are
 * different facts — `properties: []` says the type has no properties, and a
 * missing `properties` says the type never loaded.
 */
const AGENT_VIEW = {
  types: {
    keep: [
      'file',
      'about',
      'appearance',
      'looksWrongWhen',
      'invariant',
      'properties',
      'hooks',
      'uses',
      'behaviours',
      'error'
    ],
    always: ['file', 'properties', 'hooks']
  },
  behaviours: {
    keep: ['file', 'about', 'properties', 'hooks', 'error'],
    always: ['file', 'properties', 'hooks']
  },
  levels: {
    keep: ['file', 'entities', 'types', 'behaviours', 'error'],
    always: ['file', 'entities', 'types', 'behaviours']
  },
  tests: {
    keep: ['file', 'title', 'level', 'error'],
    always: ['file']
  }
}

/** One record cut down to the fields the agent view names, in that order. */
function agentRecord(record, { keep, always }) {
  const out = {}
  for (const field of keep) {
    const value = record[field]
    if (value === undefined) continue
    if (!always.includes(field) && (value === '' || (Array.isArray(value) && !value.length))) continue
    out[field] = value
  }
  return out
}

/** Every record of one kind, cut down for an agent. */
function agentRecords(records, view) {
  return Object.fromEntries(Object.entries(records).map(([name, record]) => [name, agentRecord(record, view)]))
}

/** The index again, cut down to what an agent reads. */
function buildAgentView(index) {
  return {
    types: agentRecords(index.types, AGENT_VIEW.types),
    behaviours: agentRecords(index.behaviours, AGENT_VIEW.behaviours),
    levels: agentRecords(index.levels, AGENT_VIEW.levels),
    tests: agentRecords(index.tests, AGENT_VIEW.tests),
    // Keyed by path, not basename, so "what kind is this file" is an exact
    // lookup rather than a guess across folders.
    assets: Object.fromEntries(Object.values(index.assets).map(asset => [asset.file, asset.kind]))
  }
}

/**
 * Write the index and the agent view beside the project.
 *
 * Compact, not indented. Every reader parses it — the editor, `check`, and an
 * agent through the generated agent view — so the indentation is bytes written
 * on every rebuild that nothing reads. The records are unchanged.
 */
export async function writeIndexFiles(projectDirectory, index) {
  await fs.mkdir(path.join(projectDirectory, '.engine'), { recursive: true })
  await writeAtomic(path.join(projectDirectory, '.engine/index.json'), JSON.stringify(index))
  await writeAtomic(path.join(projectDirectory, '.engine/index.agent.json'), JSON.stringify(buildAgentView(index)))
}

/** A counter making each atomic write's temporary name unique within this process. */
let writeCount = 0

/**
 * Write a whole file, or none of it.
 *
 * The index is rebuilt by every boot, every save and every `check`, so several
 * agents in one checkout write it at the same time as a matter of course. A
 * plain writeFile lets one of them read the half a neighbour had written, and
 * a torn index fails `check` against files nobody touched — the reader is
 * blamed for the writer's race.
 *
 * Rename is atomic on one filesystem, so a reader sees the whole old file or
 * the whole new one. There is no lock, and there should not be: the index is
 * derived from disk, so two writers racing both produce the same bytes and
 * last-one-wins is the right answer. The run registry next door does take a
 * lock, because it accumulates rather than derives.
 */
async function writeAtomic(file, text) {
  // A rebuild that lands the same bytes as the file already holds has done its
  // work: the content a reader sees is already there. Skipping the temporary and
  // the rename leaves no window for a reader to catch a half-written index, and
  // saves the serialized characters of rewriting a file nothing changed. The
  // comparison read is the price, and a file that is not there yet — the first
  // build — pays none of it.
  const current = await fs.stat(file).then(
    stat => (stat.size === Buffer.byteLength(text) ? fs.readFile(file, 'utf8').catch(() => null) : null),
    () => null
  )
  if (current === text) return
  // The pid is not enough on its own. One process rebuilds the index on every
  // save, and two of those overlap the moment saves come faster than a write —
  // they would then share a temporary name, and the second rename would find
  // the first had already moved it away.
  const temporary = `${file}.${process.pid}.${++writeCount}.tmp`
  try {
    await fs.writeFile(temporary, text)
    await renameWhenAllowed(temporary, file)
  } catch (error) {
    await fs.rm(temporary, { force: true })
    throw error
  }
}

/**
 * Rename, allowing for a reader that has the destination open.
 *
 * Windows refuses a rename onto a file another process is reading, and the
 * index is read by every `check`, every agent and every editor boot — so a busy
 * checkout meets EPERM as a matter of course. It clears in milliseconds. The
 * only wrong answer is to treat the first refusal as final, because the caller
 * is usually a file watcher and a throw there ends the whole dev server.
 *
 * A plain timer, not `context.after`: this is build tooling in node, running
 * outside any world, and there is no fixed clock here to be deterministic on.
 */
async function renameWhenAllowed(from, to, tries = 5) {
  const BUSY = new Set(['EPERM', 'EBUSY', 'EACCES'])
  for (let attempt = 1; ; attempt++) {
    try {
      return await fs.rename(from, to)
    } catch (error) {
      if (attempt >= tries || !BUSY.has(error.code)) throw error
      await new Promise(resolve => setTimeout(resolve, attempt * 20))
    }
  }
}
