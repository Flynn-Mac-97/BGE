/**
 * Kernel: the `.agent.md` guides beside every plugin, in the shape the
 * agent-context builder reads.
 *
 * Two starters list them — the dev server in the browser's path and the headless
 * one in a node process — and they used to hold a copy each. A guide that routes
 * one way in one and another way in the other is a packet that disagrees with
 * itself about which file a task touches, which is worse than a missing guide.
 */
import fs from 'node:fs/promises'
import path from 'node:path'

import { PROJECT_PREFIX } from './asset-path.js'

/** The `.agent.md` names in one directory, sorted. An absent directory has none. */
async function guideFileNames(directory) {
  try {
    const names = await fs.readdir(directory)
    return names.filter(name => name.endsWith('.agent.md')).sort()
  } catch {
    return []
  }
}

/** The plugin name from the source's default export, or the file's stem. */
function pluginNameIn(source, stem) {
  return source.match(/export\s+default\s+\{[\s\S]*?\bname:\s*['"]([^'"]+)['"]/m)?.[1] || stem
}

/**
 * What a guide's frontmatter declares: extra match paths, and trigger words.
 *
 * A declared trigger list is the whole list. The name-derived words below are a
 * fallback for a guide with none: `screen` alone pulls the game-screen plugin
 * into every task that mentions the rendered frame, and See already answers
 * those. A guide that knows its own words states them instead.
 */
function guideFrontmatter(guide) {
  const declared = guide.match(/^---\s*\n([\s\S]*?)\n---/)?.[1]
  const extra = declared?.match(/^match:\s*(.+)$/m)?.[1]?.trim().split(/\s+/).filter(Boolean) || []
  const saidTriggers = declared?.match(/^triggers:\s*(.+)$/m)?.[1]?.split(',').map(word => word.trim().toLowerCase()).filter(Boolean) || []
  return { extra, saidTriggers }
}

/**
 * The paths a guide applies to.
 *
 * A guide applies to its own plugin by default. A leading frontmatter `match:`
 * (space-separated paths) adds more — Plugin Master uses it to ride along with
 * every plugin task. `project/` is the one name for a file in the open project,
 * whatever the directory is called on disk, so guides declare
 * `match: project/**` and are right for every project.
 */
function guideMatch(place, stem, extra) {
  const own = `${place.scope === 'project' ? PROJECT_PREFIX + '/' : ''}${place.prefix}/${stem}.js`
  return [...new Set([own, ...extra])]
}

/** A guide's trigger words: the declared ones, or the two derived from its name. */
function guideTriggers(saidTriggers, stem, plugin) {
  if (saidTriggers.length) return saidTriggers
  return [stem.replaceAll('-', ' '), plugin.toLowerCase()]
}

/** One guide, as the instruction node an agent-context packet carries. */
async function readGuide(place, name, disabled) {
  const stem = name.slice(0, -'.agent.md'.length)
  const source = await fs.readFile(path.join(place.directory, `${stem}.js`), 'utf8').catch(() => '')
  const plugin = pluginNameIn(source, stem)
  const guide = await fs.readFile(path.join(place.directory, name), 'utf8').catch(() => '')
  const { extra, saidTriggers } = guideFrontmatter(guide)
  return {
    id: `plugin-${place.scope}-${stem}`, title: plugin, kind: 'instruction', parent: 'plugins',
    scope: place.scope, file: `${place.prefix}/${name}`,
    // The plugin the guide documents. A packet parses it so the interface
    // an agent reads is the code now, not a list somebody kept in step.
    source: source ? `${place.prefix}/${stem}.js` : null,
    match: guideMatch(place, stem, extra),
    triggers: guideTriggers(saidTriggers, stem, plugin),
    enabled: !disabled.has(plugin), plugin
  }
}

/**
 * Every plugin guide, as instruction nodes.
 *
 * @param root              the checkout, holding `plugins/builtin`
 * @param projectDirectory  the open project, holding its own `plugins`
 */
export async function pluginGuides(root, projectDirectory) {
  // Optional: a new project has no game.json, and refusing to list the plugin
  // guides would leave the first agent in it with no packet.
  const game = JSON.parse(
    await fs.readFile(path.join(projectDirectory, 'game.json'), 'utf8').catch(() => '{}'))
  const disabled = new Set(game.plugins?.disabled || [])
  const places = [
    { scope: 'engine', directory: path.join(root, 'plugins/builtin'), prefix: 'plugins/builtin' },
    { scope: 'project', directory: path.join(projectDirectory, 'plugins'), prefix: 'plugins' }
  ]
  const found = []
  for (const place of places) {
    const names = await guideFileNames(place.directory)
    for (const name of names) found.push(await readGuide(place, name, disabled))
  }
  return found
}
