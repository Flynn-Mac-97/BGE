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
    let names = []
    try { names = await fs.readdir(place.directory) } catch { continue }
    for (const name of names.filter(name => name.endsWith('.agent.md')).sort()) {
      const stem = name.slice(0, -'.agent.md'.length)
      const source = await fs.readFile(path.join(place.directory, `${stem}.js`), 'utf8').catch(() => '')
      const plugin = source.match(/export\s+default\s+\{[\s\S]*?\bname:\s*['"]([^'"]+)['"]/m)?.[1] || stem
      // A guide applies to its own plugin by default. A leading frontmatter
      // `match:` (space-separated paths) adds more — Plugin Master uses it to
      // ride along with every plugin task.
      const guide = await fs.readFile(path.join(place.directory, name), 'utf8').catch(() => '')
      const declared = guide.match(/^---\s*\n([\s\S]*?)\n---/)?.[1]
      const extra = declared?.match(/^match:\s*(.+)$/m)?.[1]?.trim().split(/\s+/).filter(Boolean) || []
      // A guide may declare its own trigger words (comma-separated), so a task
      // that says "look at x" pulls the plugin that answers looking — and a
      // disabled plugin's words pull nothing, because the node is disabled
      // with it. This is what makes a guide a skill.
      const saidTriggers = declared?.match(/^triggers:\s*(.+)$/m)?.[1]?.split(',').map(word => word.trim().toLowerCase()).filter(Boolean) || []
      // `project/` is the one name for a file in the open project, whatever the
      // directory is called on disk. Guides declare `match: project/**` and are
      // right for every project.
      const match = [...new Set([
        `${place.scope === 'project' ? PROJECT_PREFIX + '/' : ''}${place.prefix}/${stem}.js`,
        ...extra
      ])]
      found.push({
        id: `plugin-${place.scope}-${stem}`, title: plugin, kind: 'instruction', parent: 'plugins',
        scope: place.scope, file: `${place.prefix}/${name}`,
        // The plugin the guide documents. A packet parses it so the interface
        // an agent reads is the code now, not a list somebody kept in step.
        source: source ? `${place.prefix}/${stem}.js` : null,
        match,
        triggers: [...new Set([stem.replaceAll('-', ' '), plugin.toLowerCase(), ...saidTriggers])],
        enabled: !disabled.has(plugin), plugin
      })
    }
  }
  return found
}
