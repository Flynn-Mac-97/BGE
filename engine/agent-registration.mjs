/**
 * What a fresh agent reads before it asks anything, and whether it is current.
 *
 * Registration is the difference between a guide an agent must go looking for
 * and one the harness puts in front of it. A plugin guide with `skill:` and
 * `description:` frontmatter becomes `.claude/skills/<name>/SKILL.md`, and the
 * harness lists that file's name and description at session start. It is the
 * only surface in this project measured to change an agent's first move.
 *
 * The rule for writing those files is here rather than in `vite.config.js` so
 * that `node bin/engine.mjs check` reports them against the same rule the dev
 * server writes them by. A generated file that does not match its source is a
 * failure, not a warning: the listing is read once, at session start, and every
 * agent in that session reads whatever it says.
 *
 * `projectDirectory` is a directory NAME inside `root`, the same parameter the
 * dev server and the CLI already take.
 */
import fs from 'node:fs/promises'
import path from 'node:path'

/** Where the harness looks. Fixed by the harness, not by this project. */
const SKILL_DIRECTORY = '.claude/skills'

/**
 * The engine's name, and the prefix on every skill it registers.
 *
 * A skill listing holds whatever else the user has installed. One prefix makes
 * this engine's tools one search — `/glass` — rather than sixty names to
 * recognise among strangers.
 */
const ENGINE = 'glass'

/**
 * What a guide is listed as when it declares no skill name.
 *
 * Sixty of sixty-two guides declare none, so a rule that only registers a
 * declared name registers almost nothing. The file's own stem is already the
 * plugin's name and is already unique in its directory.
 */
const skillNameFor = guide => `${ENGINE}-${guide.frontmatter.skill || guide.stem}`

/**
 * Whether a plugin belongs in the listing at all.
 *
 * The listing is what an agent reads before its first tool call, and it costs
 * every agent every session, so it holds what an agent drives. A panel, a
 * gizmo or a renderer half is worked by a person in the editor and says
 * `skill: none`.
 */
const listedForAgents = guide => !['none', 'false'].includes((guide.frontmatter.skill || '').toLowerCase())

/**
 * How long a derived description may run.
 *
 * Every agent reads every description at session start, so the listing's whole
 * cost is this number times the number of plugins. Enough for a title and two
 * clauses.
 */
const DESCRIPTION_LIMIT = 200

/**
 * What a guide is listed as, from the guide itself.
 *
 * The listing is read before any tool call, so a plugin with no description is
 * one nothing finds. A declared `description:` always wins; otherwise the
 * heading names the subject and the opening lines say what it does, which is
 * what these guides already hold.
 */
function describedBy(guide) {
  if (guide.frontmatter.description) return guide.frontmatter.description
  const title = guide.body.match(/^#\s+(.+)$/m)?.[1]?.trim()
  const opening = guide.body
    .replace(/^#[^\n]*\n+/, '')
    .split(/\n\s*\n/)
    .map(block => block.trim())
    .find(block => block && !block.startsWith('#') && !block.startsWith('```') && !block.startsWith('|'))
  if (!title && !opening) return null
  const sentences = (opening || '')
    .split('\n')
    .map(line => line.replace(/^[-*]\s*/, '').trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
  const full = [title, sentences].filter(Boolean).join(' — ')
  return full.length > DESCRIPTION_LIMIT ? `${full.slice(0, DESCRIPTION_LIMIT - 3)}...` : full
}

/**
 * How a generated skill is told from a hand-written one.
 *
 * Cleanup deletes only files carrying this, so a skill a person wrote by hand
 * survives. Its exact text is part of every generated file, so changing it
 * makes every skill file mismatch until they are written again.
 */
const GENERATED_MARKER = '<!-- generated from '

/** A skill name is a directory name. Reject anything that would not be one. */
const SKILL_NAME = /^[a-z0-9][a-z0-9-]*$/

/** The source of AGENTS.md, which is a copy of it. */
const BOOTSTRAP = 'agents/bootstrap.md'

const forwardSlashes = text => text.split(path.sep).join('/')

/** The two places plugins are found, engine first, as the loader reads them. */
const pluginPlaces = (root, projectDirectory) => [
  {
    scope: 'engine',
    directory: path.join(root, 'plugins/builtin'),
    prefix: 'plugins/builtin',
    fromRoot: 'plugins/builtin'
  },
  {
    scope: 'project',
    directory: path.join(root, projectDirectory, 'plugins'),
    prefix: 'plugins',
    fromRoot: `${forwardSlashes(projectDirectory)}/plugins`
  }
]

/**
 * The frontmatter fields a guide may declare.
 *
 * Read with the same expressions the dev server and the headless runner use, so
 * a guide cannot register one way here and route another way there.
 */
function frontmatterOf(guide) {
  const block = guide.match(/^---\s*\n([\s\S]*?)\n---/)?.[1]
  const field = name => block?.match(new RegExp(`^${name}:\\s*(.+)$`, 'm'))?.[1]?.trim()
  return { skill: field('skill'), description: field('description'), triggers: field('triggers'), match: field('match') }
}

/** The guide without its frontmatter. This is what a skill file carries. */
const bodyOf = guide => guide.replace(/^---\s*\n[\s\S]*?\n---\s*/, '')

/**
 * Every plugin guide on disk, with what it declares and whether its plugin runs.
 *
 * `file` is named from the plugin's own scope, which is how the manifest node
 * and the generated marker name it. `fileFromRoot` is the path to open.
 */
export async function pluginGuides(root, projectDirectory) {
  const game = JSON.parse(
    await fs.readFile(path.join(root, projectDirectory, 'game.json'), 'utf8').catch(() => '{}'))
  const disabled = new Set(game.plugins?.disabled || [])
  const guides = []
  for (const place of pluginPlaces(root, projectDirectory)) {
    let names = []
    try { names = await fs.readdir(place.directory) } catch { continue }
    for (const name of names.filter(name => name.endsWith('.agent.md')).sort()) {
      const stem = name.slice(0, -'.agent.md'.length)
      const source = await fs.readFile(path.join(place.directory, `${stem}.js`), 'utf8').catch(() => null)
      const pluginName = source?.match(/export\s+default\s+\{[\s\S]*?\bname:\s*['"]([^'"]+)['"]/m)?.[1] || stem
      // Deleted between the listing and the read. A guide that is gone is not a
      // problem to report, and throwing here would end the whole check.
      const text = await fs.readFile(path.join(place.directory, name), 'utf8').catch(() => null)
      if (text === null) continue
      guides.push({
        scope: place.scope,
        stem,
        file: `${place.prefix}/${name}`,
        fileFromRoot: `${place.fromRoot}/${name}`,
        sourceFromRoot: `${place.fromRoot}/${stem}.js`,
        hasSource: source !== null,
        plugin: pluginName,
        enabled: !disabled.has(pluginName),
        frontmatter: frontmatterOf(text),
        body: bodyOf(text)
      })
    }
  }
  return guides
}

/** Plugin sources with no guide beside them. */
export async function pluginsWithoutGuide(root, projectDirectory) {
  const found = []
  for (const place of pluginPlaces(root, projectDirectory)) {
    let names = []
    try { names = await fs.readdir(place.directory) } catch { continue }
    for (const name of names.filter(name => name.endsWith('.js')).sort()) {
      const guide = path.join(place.directory, `${name.slice(0, -'.js'.length)}.agent.md`)
      if (await fs.access(guide).then(() => false, () => true)) found.push(`${place.fromRoot}/${name}`)
    }
  }
  return found
}

/**
 * Every file this engine generates for an agent to read, as it should be.
 *
 * Nothing is written here. One list serves both the writer and the check, so
 * the two can never disagree about what current means.
 */
export async function generatedAgentFiles(root, projectDirectory) {
  // No source, nothing to generate. `check` calls this, so a missing file has
  // to be an empty answer rather than an exception that stops every other
  // problem being reported.
  const bootstrap = await fs.readFile(path.join(root, BOOTSTRAP), 'utf8').catch(() => null)
  // Two copies of one source. A command line reads AGENTS.md; Claude Code puts
  // CLAUDE.md in the system prompt on every turn, which is the only carrier an
  // agent cannot skip — so the rules are inline in both, and `check` holds them
  // to the source byte for byte rather than trusting anyone to copy an edit.
  const files = bootstrap === null ? [] : [
    { path: 'AGENTS.md', source: BOOTSTRAP, text: bootstrap },
    { path: 'CLAUDE.md', source: BOOTSTRAP, text: bootstrap }
  ]
  for (const guide of await pluginGuides(root, projectDirectory)) {
    // A disabled plugin registers nothing: its commands are not there, and a
    // listed skill for a missing command is worse than no listing.
    if (!guide.enabled || !listedForAgents(guide)) continue
    const skill = skillNameFor(guide)
    const description = describedBy(guide)
    if (!description || !SKILL_NAME.test(skill)) continue
    files.push({
      path: `${SKILL_DIRECTORY}/${skill}/SKILL.md`,
      source: guide.fileFromRoot,
      text: `---\nname: ${skill}\ndescription: ${description}\n---\n${GENERATED_MARKER}${guide.file} at server start; edits are lost -->\n\n${guide.body}`
    })
  }
  return files
}

/** Generated skill files on disk, whatever guide they came from. */
async function generatedSkillsOnDisk(root) {
  const directory = path.join(root, SKILL_DIRECTORY)
  let names = []
  try { names = await fs.readdir(directory) } catch { return [] }
  const found = []
  for (const name of names) {
    const file = `${SKILL_DIRECTORY}/${name}/SKILL.md`
    const text = await fs.readFile(path.join(root, file), 'utf8').catch(() => '')
    if (text.includes(GENERATED_MARKER)) found.push({ name, path: file })
  }
  return found
}

/**
 * Write the generated files and drop the ones no guide claims any more.
 *
 * A skill left behind keeps a disabled or deleted plugin registered, and the
 * agent that invokes it gets commands that do not exist.
 */
export async function writeGeneratedAgentFiles(root, projectDirectory) {
  const files = await generatedAgentFiles(root, projectDirectory)
  for (const file of files) {
    const absolute = path.join(root, file.path)
    await fs.mkdir(path.dirname(absolute), { recursive: true })
    await fs.writeFile(absolute, file.text, 'utf8')
  }

  const wanted = new Set(files.map(file => file.path))
  for (const skill of await generatedSkillsOnDisk(root)) {
    if (wanted.has(skill.path)) continue
    await fs.rm(path.join(root, SKILL_DIRECTORY, skill.name), { recursive: true, force: true })
  }
  return files.map(file => file.path)
}

/**
 * Generated files that no longer match their source.
 *
 * Failures, not warnings. The harness reads the skill listing once at session
 * start, so a stale file is read by every agent for a whole session and there
 * is no second chance to correct it.
 */
export async function generatedFileProblems(root, projectDirectory) {
  const files = await generatedAgentFiles(root, projectDirectory)
  const problems = []
  for (const file of files) {
    const onDisk = await fs.readFile(path.join(root, file.path), 'utf8').catch(() => null)
    if (onDisk === file.text) continue
    problems.push({
      file: file.path,
      why: onDisk === null
        ? `${file.path} is generated from ${file.source} and is not on disk — start the dev server, or run writeGeneratedAgentFiles, to write it`
        : `${file.path} does not match ${file.source} it is generated from. Every agent reads the stale copy. Start the dev server, or run writeGeneratedAgentFiles, to write it`
    })
  }
  const wanted = new Set(files.map(file => file.path))
  for (const skill of await generatedSkillsOnDisk(root)) {
    if (wanted.has(skill.path)) continue
    problems.push({
      file: skill.path,
      why: `${skill.path} is a generated skill no enabled guide in ${projectDirectory} claims. It registers a plugin that is off or gone; start the dev server, or run writeGeneratedAgentFiles, to remove it`
    })
  }
  return problems
}

/**
 * Guides the harness will never show, and plugins with no guide at all.
 *
 * A plugin author who omits `skill:` ships work no future agent finds, and
 * nothing today says so. These are warnings except where an author asked for a
 * skill and the generator would silently drop it — a dropped declaration reads
 * exactly like a plugin that never wanted one.
 */
export async function skillRegistrationProblems(root, projectDirectory) {
  const problems = []
  for (const guide of await pluginGuides(root, projectDirectory)) {
    // An opt-out is a decision, not a broken declaration: the guide still
    // arrives in a packet when the task names the plugin.
    if (!guide.enabled || !listedForAgents(guide)) continue
    const { skill, description, triggers, match } = guide.frontmatter

    if (skill && !SKILL_NAME.test(skill)) {
      problems.push({
        file: guide.fileFromRoot,
        why: `skill name ${JSON.stringify(skill)} is not a directory name, so no skill is registered. Use lower-case letters, digits and hyphens`
      })
    } else if (skill && !description) {
      problems.push({
        file: guide.fileFromRoot,
        why: `declares skill "${skill}" with no description, so the generator skips it and the guide is registered nowhere. Add a description line`
      })
    }

    if (description && !skill) {
      problems.push({
        warning: true,
        file: guide.fileFromRoot,
        why: 'declares a description with no skill, so nothing is registered. Add a skill name, or drop the description'
      })
    }

    // Trigger words claim that a task using them should reach this guide.
    // Without a skill the claim holds only for an agent that already asked for
    // a packet, and that call comes after the first move is chosen.
    if (triggers && !skill) {
      problems.push({
        warning: true,
        file: guide.fileFromRoot,
        why: 'declares trigger words but no skill, so it reaches only an agent that already ran agent.context — after the first move is chosen. Add skill and description frontmatter, or expect the words to change nothing'
      })
    }

    // A guide matches its own plugin source by default. No source and no
    // declared match leaves it matching a file that is not there.
    if (!guide.hasSource && !match) {
      problems.push({
        warning: true,
        file: guide.fileFromRoot,
        why: `has no plugin at ${guide.sourceFromRoot} and declares no match, so no task ever pulls it in. Add a match line, or the plugin`
      })
    }
  }

  for (const source of await pluginsWithoutGuide(root, projectDirectory)) {
    problems.push({
      warning: true,
      file: source,
      why: 'has no .agent.md guide, so it appears in no packet and no skill listing. Every command it registers is undiscoverable'
    })
  }

  problems.push(...await manifestSkillProblems(root))
  return problems
}

/**
 * Manifest skill nodes the harness never sees.
 *
 * `agents/manifest.json` has a `skill` node kind, and those nodes reach an
 * agent only through a packet. A guide's `skill:` frontmatter is the one route
 * into the session listing, so a manifest skill is a skill in name only.
 */
async function manifestSkillProblems(root) {
  const manifest = JSON.parse(
    await fs.readFile(path.join(root, 'agents/manifest.json'), 'utf8').catch(() => '{"nodes":[]}'))
  const registered = new Set((await generatedSkillsOnDisk(root)).map(skill => skill.name))
  return (manifest.nodes || [])
    .filter(node => node.kind === 'skill' && !registered.has(node.id))
    .map(node => ({
      warning: true,
      file: node.file || 'agents/manifest.json',
      why: `manifest node "${node.id}" is kind "skill" but is not in ${SKILL_DIRECTORY}, so no session lists it. Only an agent that ran agent.context with a matching word finds it`
    }))
}

/**
 * The ids in a plugin's `commands` array, and nothing else.
 *
 * Panels, menus and fields carry ids of the same shape, so a plain search over
 * the file names things no agent would ever call. The array is read by
 * bracket depth from `commands:` to its close; a plugin that builds its
 * commands somewhere else answers nothing rather than a guess.
 */
function commandIds(source) {
  const start = source.search(/\bcommands:\s*\[/)
  if (start < 0) return []
  let depth = 0
  let index = source.indexOf('[', start)
  const from = index
  for (; index < source.length; index++) {
    if (source[index] === '[') depth++
    else if (source[index] === ']' && --depth === 0) break
  }
  return [...source.slice(from, index).matchAll(/id:\s*'([a-z][\w-]*\.[\w.-]+)'/g)].map(match => match[1])
}

/**
 * Commands a plugin registers that its own guide never names.
 *
 * The guide is what an agent reads before its first call, so a verb missing
 * from it is a verb nothing will use.
 *
 * A warning, not a failure: a plugin may register something deliberately
 * internal, and a guide is prose that cannot be generated from an id.
 */
export async function undocumentedCommandProblems(root, projectDirectory) {
  const problems = []
  for (const guide of await pluginGuides(root, projectDirectory)) {
    if (!guide.enabled || !guide.hasSource) continue
    const source = await fs.readFile(path.join(root, guide.sourceFromRoot), 'utf8').catch(() => null)
    if (source === null) continue
    const missing = [...new Set(commandIds(source))].filter(id => !guide.body.includes(id)).sort()
    if (!missing.length) continue
    problems.push({
      warning: true,
      file: guide.fileFromRoot,
      why: `registers ${missing.join(', ')} and its guide names none of them. An agent reads the guide before its first call, so an undocumented verb is one nothing will use`
    })
  }
  return problems
}

/** Everything this module reports, for one call from `check`. */
export async function agentRegistrationProblems(root, projectDirectory) {
  return [
    ...await generatedFileProblems(root, projectDirectory),
    ...await skillRegistrationProblems(root, projectDirectory),
    ...await undocumentedCommandProblems(root, projectDirectory)
  ]
}
