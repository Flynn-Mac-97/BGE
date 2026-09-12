/**
 * Kernel: where a project is on disk.
 *
 * A project is a directory path and may be anywhere. This module is the one
 * place that turns what a person typed into an absolute directory, so the CLI,
 * the dev server and the headless runner cannot drift on the rule.
 *
 * Node only. The browser never resolves a project path: the dev server serves
 * the open project at the fixed URL `/project/` whatever its disk path, so the
 * page needs a display name and nothing else.
 */

import path from 'node:path'
import fs from 'node:fs/promises'

/**
 * The directory a project with no name yet is kept in.
 *
 * Unsaved does not mean in memory. Files on disk are still the truth, so an
 * untitled project is a real directory and saving it is a rename. Named with a
 * leading dot so it sorts out of the way and `project.list` can skip it.
 */
export const UNTITLED = '.untitled'

/**
 * Where projects are kept.
 *
 * Beside the checkout rather than inside it, so the engine repository holds no
 * game. A game in the checkout is read by every agent doing engine work, and it
 * changes what the agent concludes.
 */
export function projectsRoot(checkout) {
  const said = process.env.ENGINE_PROJECTS_ROOT
  return said ? path.resolve(said) : path.resolve(checkout, '..', 'engine-projects')
}

/** The untitled project's directory. It is created on first use, not here. */
export const untitledProject = checkout => path.join(projectsRoot(checkout), UNTITLED)

/**
 * Whether a directory is the untitled project.
 *
 * Taken from the directory, never from the title: a named project is free to
 * call itself "untitled", and a save rule that trusted the title would throw
 * that project's edits away.
 */
export const isUntitled = projectPath => path.basename(String(projectPath || '')) === UNTITLED

/**
 * The project directory a caller asked for.
 *
 * Resolved against the checkout, so `project` still means the directory of that
 * name inside it, `../engine-projects/foo` reaches a sibling, and an absolute
 * path is taken as given. Nothing asked for means the untitled project.
 */
export function resolveProject(checkout, said) {
  const wanted = typeof said === 'string' ? said.trim() : ''
  return wanted ? path.resolve(checkout, wanted) : untitledProject(checkout)
}

/**
 * What the editor shows for a project.
 *
 * `game.json` names it if the author wrote a title; otherwise the directory is
 * the name. The untitled project has neither, and says so.
 */
export function projectName(projectPath, title) {
  if (title) return title
  const base = path.basename(projectPath)
  return base === UNTITLED ? 'untitled' : base
}

/**
 * Make sure a project directory is there, and is openable.
 *
 * A project needs one level: with none, the editor's level name stays `—` and
 * every editing gesture saves to a file of that name. Creating the starter
 * level is how that is prevented, rather than guarding a dozen save sites.
 *
 * Existing files are never touched, so this is safe to call on every start.
 */
export async function ensureProject(projectPath, name) {
  const put = async (file, text) => {
    const target = path.join(projectPath, file)
    await fs.mkdir(path.dirname(target), { recursive: true })
    if (await fs.stat(target).then(() => true, () => false)) return false
    await fs.writeFile(target, text, 'utf8')
    return true
  }
  await fs.mkdir(projectPath, { recursive: true })
  await put('game.json', JSON.stringify({
    title: name || projectName(projectPath),
    startLevel: 'main'
  }, null, 2) + '\n')
  await put('levels/main.json', JSON.stringify({
    camera: { mode: 'ortho', at: [0, 0], zoom: 48 },
    entities: []
  }, null, 2) + '\n')
  return projectPath
}
