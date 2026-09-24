/**
 * What a fresh agent reads before it asks anything, and whether it is current.
 *
 * Registration is the difference between a guide an agent must go looking for
 * and one the harness puts in front of it. A plugin guide with `skill:` and
 * `description:` frontmatter becomes a skill in each agent's discovery directory. The
 * harness lists that file's name and description at session start. It is the
 * only surface in this project measured to change an agent's first move.
 *
 * The rule for writing those files is here rather than in `vite.config.js` so
 * that `node bin/engine.mjs check` reports them against the same rule the dev
 * server writes them by. A generated file that does not match its source is a
 * failure, not a warning: the listing is read once, at session start, and every
 * agent in that session reads whatever it says.
 *
 * `projectPath` is the open project's directory, resolved against `root` — the
 * same parameter the dev server and the CLI already take.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { PROJECT_PREFIX } from './asset-path.js'
import { projectName } from './project-path.mjs'
import { BUILTIN_REGISTERED_TYPES, loadedModuleSource, registeredTypeNames } from './project-index.mjs'

/** Where the harness looks. Fixed by the harness, not by this project. */
const SKILL_DIRECTORY = '.claude/skills'
const CODEX_SKILL_DIRECTORY = '.agents/skills'

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
 * Every category a guide may declare. The always-on one is first.
 *
 * The listing is read by every agent before its first tool call, so it holds
 * what the engine itself needs. What a game is built from is a category a
 * checkout switches on for the task in hand. This is the vocabulary; the
 * manifest holds the switches.
 */
const CATEGORIES = ['core', 'engine', 'gameplay', 'presentation', 'assets', 'authoring', 'harnesses']

/**
 * The category a guide belongs to when it declares none.
 *
 * An unclassified guide is one whose cost nobody decided, so it joins the
 * always-on set and `check` says so.
 */
const DEFAULT_CATEGORY = 'core'

/**
 * Which categories this checkout registers, from the manifest.
 *
 * A category nobody switched on is out of the listing. That is the answer that
 * costs the least when a name is misspelled: a skill that is absent is noticed,
 * and one that is present is paid for by every agent of the session.
 *
 * No block at all is different — a manifest that is missing or unreadable
 * costs the optional skills, not every skill.
 */
async function enabledCategories(root) {
  const manifest = JSON.parse(await fs.readFile(path.join(root, MANIFEST), 'utf8').catch(() => '{"nodes":[]}'))
  const declared = manifest.skillCategories
  if (!declared || typeof declared !== 'object') return new Set([DEFAULT_CATEGORY])
  return new Set(CATEGORIES.filter(name => declared[name] === true))
}

/** A guide's category, or the default when it declares none. */
const categoryOf = guide => guide.frontmatter.category || DEFAULT_CATEGORY

/**
 * How long a description may run.
 *
 * A declared one may be long, because it is the only thing that decides whether
 * a skill is found: it has to say what the plugin does AND when to reach for it,
 * and both together do not fit in a line.
 *
 * A derived one is held much shorter. It is a fallback, and no length of
 * generated prose says when to use anything — the extra characters would be
 * paid by every agent at session start and buy no trigger.
 */
const DESCRIPTION_LIMIT = 1024
const DERIVED_LIMIT = 180

/**
 * A whole sentence, or as many as fit.
 *
 * Cutting mid-word leaves a description that reads as broken text, and cutting
 * inside a code span or an options object leaves a fragment that names nothing.
 * So a derived description ends where a sentence ends, and only falls back to a
 * word boundary when the very first sentence is already too long.
 */
function firstSentences(text, limit) {
  const whole = text.trim()
  if (whole.length <= limit) return whole
  // A code span holds dots that end no sentence — `context.crowd`,
  // `world.toLevel()` — so they are hidden from the split and put back after.
  const spans = []
  const masked = whole.replace(/`[^`]*`/g, span => {
    spans.push(span)
    return `@@${spans.length - 1}@@`
  })
  /** Put the masked code spans back, so a split never cut inside one. */
  const restore = value => value.replace(/@@(\d+)@@/g, (_, index) => spans[index])
  const sentences = masked.match(/[^.!?]+[.!?]+(\s|$)/g) || []
  let out = ''
  for (const sentence of sentences) {
    if (restore((out + sentence).trim()).length > limit) break
    out += sentence
  }
  if (out.trim()) return restore(out.trim())
  // One long opening sentence. Keep whole words, and never cut inside a span.
  const kept = masked.slice(0, limit - 1).replace(/\s+\S*$/, '')
  return restore(kept.replace(/@@\d*$/, '').trim()) + '…'
}

/**
 * What a guide is listed as, from the guide itself.
 *
 * The listing is read before any tool call, so a plugin with no description is
 * one nothing finds. A declared `description:` always wins, and every guide
 * worth finding should declare one. The fallback below only keeps a plugin from
 * being invisible; it names the subject and says what it does, and it cannot
 * say when to use it.
 */
function describedBy(guide) {
  if (guide.frontmatter.description) {
    const declared = guide.frontmatter.description.trim()
    return declared.length > DESCRIPTION_LIMIT ? firstSentences(declared, DESCRIPTION_LIMIT) : declared
  }
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
  const room = title ? DERIVED_LIMIT - title.length - 3 : DERIVED_LIMIT
  // A sentence ending in a colon introduces a block that is not here, so the
  // colon would promise something the description never delivers.
  const body = room > 40 ? firstSentences(sentences, room).replace(/:$/, '.') : ''
  return [title, body].filter(Boolean).join(' — ')
}

/**
 * One frontmatter value as YAML.
 *
 * A description is a sentence, and a sentence holds colons — "Options: …",
 * "Blender 3D: …". Unquoted, YAML reads the first colon as a nested mapping
 * and rejects the block; pi then drops the whole skill, so the file is on disk
 * and no listing names it. Inside quotes a backslash or a quote must be
 * escaped, or the description ends early.
 */
const yamlValue = value => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`

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

/** The instruction tree, which also declares which skill categories register. */
const MANIFEST = 'agents/manifest.json'

/** The two places plugins are found, engine first, as the loader reads them. */
const pluginPlaces = (root, projectPath) => [
  {
    scope: 'engine',
    directory: path.join(root, 'plugins/builtin'),
    prefix: 'plugins/builtin',
    fromRoot: 'plugins/builtin'
  },
  {
    scope: 'project',
    directory: path.join(path.resolve(root, projectPath), 'plugins'),
    prefix: 'plugins',
    // `project/`, not the directory's own name: one spelling for a project file
    // whatever the directory is called and wherever it is.
    fromRoot: `${PROJECT_PREFIX}/plugins`
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
  /** One frontmatter field's value, or undefined when the guide does not declare it. */
  const field = name => block?.match(new RegExp(`^${name}:\\s*(.+)$`, 'm'))?.[1]?.trim()
  return {
    skill: field('skill'),
    category: field('category'),
    description: field('description'),
    triggers: field('triggers'),
    match: field('match')
  }
}

/** The guide without its frontmatter. This is what a skill file carries. */
const bodyOf = guide => guide.replace(/^---\s*\n[\s\S]*?\n---\s*/, '')

/**
 * Every detail file beside a guide, joined.
 *
 * A guide keeps its interface and puts the rest in `<stem>.agent/`, so a check
 * that read only the guide would call a verb documented there undocumented.
 * Not part of the skill — the whole point is that an agent opens one of these
 * only when its task needs it.
 */
async function detailOf(directory, stem) {
  const detailDirectory = path.join(directory, `${stem}.agent`)
  const names = await fs.readdir(detailDirectory).catch(() => [])
  // Together rather than one at a time: a guide may keep many detail files, and
  // waiting for each read before starting the next is time spent doing nothing.
  const parts = await Promise.all(
    names
      .filter(name => name.endsWith('.md'))
      .sort()
      .map(name => fs.readFile(path.join(detailDirectory, name), 'utf8').catch(() => ''))
  )
  return parts.join('\n')
}

/**
 * Every plugin guide on disk, with what it declares and whether its plugin runs.
 *
 * `file` is named from the plugin's own scope, which is how the manifest node
 * and the generated marker name it. `fileFromRoot` is the path to open.
 */
export async function pluginGuides(root, projectPath, { detail = true } = {}) {
  const game = JSON.parse(
    await fs.readFile(path.join(path.resolve(root, projectPath), 'game.json'), 'utf8').catch(() => '{}')
  )
  const disabled = new Set(game.plugins?.disabled || [])
  const guides = []
  for (const place of pluginPlaces(root, projectPath)) {
    let names
    try {
      names = await fs.readdir(place.directory)
    } catch {
      continue
    }
    // A guide, its source and its detail files, read together. This is every
    // plugin in the checkout — guide, source and detail for each — and reading
    // them one at a time was most of what `check` spent its time on. The list is
    // sorted first and `Promise.all` keeps that order, so the problems are
    // reported in the same order they always were.
    //
    // `check` never reads a guide's detail files: they carry what an agent opens
    // on demand, and the checks here answer from the guide, its source and its
    // frontmatter. Reading eighty detail directories to throw the answer away
    // was most of one check's directory reads.
    const found = await Promise.all(
      names
        .filter(name => name.endsWith('.agent.md'))
        .sort()
        .map(async name => {
          const stem = name.slice(0, -'.agent.md'.length)
          const sourceFile = path.join(place.directory, `${stem}.js`)
          // The loader already read this file when `check` imported every plugin
          // to find the ones that will not load. Reuse that text rather than read
          // the same bytes a second time; a caller with no import behind it gets
          // undefined here and the disk read below as before.
          const [source, text, detailText] = await Promise.all([
            loadedModuleSource(sourceFile) ?? fs.readFile(sourceFile, 'utf8').catch(() => null),
            fs.readFile(path.join(place.directory, name), 'utf8').catch(() => null),
            detail ? detailOf(place.directory, stem) : ''
          ])
          // Deleted between the listing and the read. A guide that is gone is not a
          // problem to report, and throwing here would end the whole check.
          if (text === null) return null
          const pluginName = source?.match(/export\s+default\s+\{[\s\S]*?\bname:\s*['"]([^'"]+)['"]/m)?.[1] || stem
          // The folder category decides whether a guide is tooling an agent is
          // expected to reach for, which is what makes an opt-out a defect
          // rather than a decision. Read from the source like the name above.
          const pluginCategory =
            source?.match(/export\s+default\s+\{[\s\S]*?\bcategory:\s*['"]([^'"]+)['"]/m)?.[1] || null
          return {
            scope: place.scope,
            stem,
            file: `${place.prefix}/${name}`,
            fileFromRoot: `${place.fromRoot}/${name}`,
            sourceFromRoot: `${place.fromRoot}/${stem}.js`,
            hasSource: source !== null,
            plugin: pluginName,
            pluginCategory,
            enabled: !disabled.has(pluginName),
            // The type names this plugin contributes, read from the same source
            // the loader will run. The index reads the generated catalog built
            // from these, and this is what holds the catalog to the sources.
            registers: registeredTypeNames(source || ''),
            frontmatter: frontmatterOf(text),
            body: bodyOf(text),
            detail: detailText
          }
        })
    )
    guides.push(...found.filter(Boolean))
  }
  return guides
}

/** Plugin sources with no guide beside them. */
export async function pluginsWithoutGuide(root, projectPath) {
  const found = []
  for (const place of pluginPlaces(root, projectPath)) {
    let names
    try {
      names = await fs.readdir(place.directory)
    } catch {
      continue
    }
    // Asked together. This is one `fs.access` per plugin in the checkout, and
    // waiting for each answer before asking the next is the whole of its cost.
    const missing = await Promise.all(
      names
        .filter(name => name.endsWith('.js'))
        .sort()
        .map(async name => {
          const guide = path.join(place.directory, `${name.slice(0, -'.js'.length)}.agent.md`)
          return await fs.access(guide).then(
            () => null,
            () => `${place.fromRoot}/${name}`
          )
        })
    )
    found.push(...missing.filter(Boolean))
  }
  return found
}

/**
 * Every file this engine generates for an agent to read, as it should be.
 *
 * Nothing is written here. One list serves both the writer and the check, so
 * the two can never disagree about what current means.
 */
export async function generatedAgentFiles(root, projectPath, guides = null) {
  // No source, nothing to generate. `check` calls this, so a missing file has
  // to be an empty answer rather than an exception that stops every other
  // problem being reported.
  const bootstrap = await fs.readFile(path.join(root, BOOTSTRAP), 'utf8').catch(() => null)
  // Two copies of one source. A command line reads AGENTS.md; Claude Code puts
  // CLAUDE.md in the system prompt on every turn, which is the only carrier an
  // agent cannot skip — so the rules are inline in both, and `check` holds them
  // to the source byte for byte rather than trusting anyone to copy an edit.
  const files =
    bootstrap === null
      ? []
      : [
          { path: 'AGENTS.md', source: BOOTSTRAP, text: bootstrap },
          { path: 'CLAUDE.md', source: BOOTSTRAP, text: bootstrap }
        ]
  const known = guides || (await pluginGuides(root, projectPath))
  const enabled = await enabledCategories(root)
  for (const guide of known) {
    // The listing belongs to the engine, not to whichever game is open. It is
    // written when the workspace opens and does not change when the project
    // does, so two games in one checkout cannot overwrite each other's. A
    // game's own plugins reach an agent through its instruction packet, which
    // the words in the task already route.
    //
    // A game that switches a builtin off is reported by
    // `skillRegistrationProblems`, because the listing then names a command
    // that game does not have.
    //
    // A category that is off is left out the same way: the guide still reaches
    // a packet that names its plugin, and its skill comes back when the
    // category is switched on again.
    if (guide.scope !== 'engine' || !listedForAgents(guide) || !enabled.has(categoryOf(guide))) continue
    const skill = skillNameFor(guide)
    const description = describedBy(guide)
    if (!description || !SKILL_NAME.test(skill)) continue
    // Keep one generated interface beside the guide and link it from skills.
    const where = guide.hasSource
      ? `Read the generated interface in \`${guide.sourceFromRoot.replace(/\.js$/, '.agent/interface.generated.md')}\`.` +
        ` Plugin edits refresh it while the server runs. This packet command also checks freshness:\n\n` +
        '```sh\nnode bin/engine.mjs agent.context \'{"task":"…","files":["' +
        `${guide.sourceFromRoot}"]}'\n\`\`\`\n\n`
      : ''
    files.push({
      path: `${SKILL_DIRECTORY}/${skill}/SKILL.md`,
      source: guide.fileFromRoot,
      text: `---\nname: ${skill}\ndescription: ${yamlValue(description)}\n---\n${GENERATED_MARKER}${guide.file} at server start; edits are lost -->\n\n${where}${guide.body}`
    })
  }
  // The engine-contributed types, compiled from the same sources the guides
  // above are read from, so the index learns them with one small read instead of
  // scanning every builtin plugin on every rebuild. Generated and checked like
  // every other file here: a plugin edit that adds a type makes this stale, and
  // `check` says so.
  files.push({
    path: BUILTIN_REGISTERED_TYPES,
    source: 'plugins/builtin/*.js',
    text: registeredTypesText(known)
  })
  files.push(...(await manifestSkillFiles(root, new Set(files.map(file => file.path)), enabled)))
  files.push(
    ...files
      .filter(file => file.path.startsWith(`${SKILL_DIRECTORY}/`))
      .map(file => ({
        ...file,
        path: file.path.replace(SKILL_DIRECTORY, CODEX_SKILL_DIRECTORY)
      }))
  )
  return files
}

/**
 * The engine-contributed type names, as the generated catalog holds them.
 *
 * Sorted and deduped, so the file is the same bytes whatever order the guides
 * were read in and a check compares it byte for byte.
 */
export function registeredTypesText(guides) {
  const types = [
    ...new Set(guides.filter(guide => guide.scope === 'engine').flatMap(guide => guide.registers || []))
  ].sort()
  return `${JSON.stringify({ source: 'plugins/builtin/*.js', types }, null, 2)}\n`
}

/**
 * Skills written by hand rather than derived from a plugin guide.
 *
 * `agents/manifest.json` has a `skill` node kind whose file a person writes.
 * Without this they reach only an agent that already ran `agent.context`, so a
 * skill the manifest lists is one no session sees. Registered under the same
 * prefix as the rest, and read from the same file the manifest names.
 */
async function manifestSkillFiles(root, taken = new Set(), enabled = new Set([DEFAULT_CATEGORY])) {
  const manifest = JSON.parse(await fs.readFile(path.join(root, MANIFEST), 'utf8').catch(() => '{"nodes":[]}'))
  const files = []
  for (const node of manifest.nodes || []) {
    if (node.kind !== 'skill' || !node.file) continue
    // A hand-written skill belongs to a category like any other, so a checkout
    // that keeps its listing small keeps it of this one too.
    if (!enabled.has(node.category || DEFAULT_CATEGORY)) continue
    const skill = `${ENGINE}-${node.id}`
    if (!SKILL_NAME.test(skill)) continue
    // A plugin's own guide owns the name. It is the live plugin, and two
    // sources writing one file would leave whichever ran last on disk.
    if (taken.has(`${SKILL_DIRECTORY}/${skill}/SKILL.md`)) continue
    const source = await fs.readFile(path.join(root, node.file), 'utf8').catch(() => null)
    if (source === null) continue
    const description = frontmatterOf(source).description || node.title
    if (!description) continue
    files.push({
      path: `${SKILL_DIRECTORY}/${skill}/SKILL.md`,
      source: node.file,
      text: `---
name: ${skill}
description: ${yamlValue(description)}
---
${GENERATED_MARKER}${node.file} at server start; edits are lost -->

${bodyOf(source)}`
    })
  }
  return files
}

/** Generated skill files on disk, whatever guide they came from. */
async function generatedSkillsOnDisk(root) {
  const lists = await Promise.all(
    [SKILL_DIRECTORY, CODEX_SKILL_DIRECTORY].map(directory => generatedSkillsInDirectory(root, directory))
  )
  return lists.flat()
}

async function generatedSkillsInDirectory(root, skillDirectory) {
  const directory = path.join(root, skillDirectory)
  let names
  try {
    names = await fs.readdir(directory)
  } catch {
    return []
  }
  const found = []
  for (const name of names) {
    const file = `${skillDirectory}/${name}/SKILL.md`
    const text = await fs.readFile(path.join(root, file), 'utf8').catch(() => '')
    // An empty file is a write that did not finish. It carries no marker, so
    // treating "no marker" as hand-written would leave it on disk for good —
    // and the harness lists it, with no name and no description.
    //
    // The text read here is the file's text, so the freshness check below
    // compares against it rather than reading every SKILL.md a second time.
    if (text.includes(GENERATED_MARKER) || !text.trim()) found.push({ name, path: file, text })
  }
  return found
}

/**
 * Write the generated files and drop the ones no guide claims any more.
 *
 * A skill left behind keeps a disabled or deleted plugin registered, and the
 * agent that invokes it gets commands that do not exist.
 */
export async function writeGeneratedAgentFiles(root, projectPath) {
  const files = await generatedAgentFiles(root, projectPath)
  for (const file of files) {
    const absolute = path.join(root, file.path)
    await fs.mkdir(path.dirname(absolute), { recursive: true })
    await fs.writeFile(absolute, file.text, 'utf8')
  }

  const wanted = new Set(files.map(file => file.path))
  for (const skill of await generatedSkillsOnDisk(root)) {
    if (wanted.has(skill.path)) continue
    const directory = path.resolve(root, path.dirname(skill.path))
    const relative = path.relative(path.resolve(root), directory)
    if (relative.startsWith('..') || path.isAbsolute(relative))
      throw new Error('Skill directory is outside the checkout')
    await fs.rm(directory, { recursive: true, force: true })
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
export async function generatedFileProblems(root, projectPath, guides = null, skillsOnDisk = null) {
  const files = await generatedAgentFiles(root, projectPath, guides)
  // The skill listing already read every generated SKILL.md to tell a generated
  // one from a hand-written one, so the freshness check compares against that
  // text rather than reading each file a second time.
  const alreadyRead = new Map((skillsOnDisk || []).map(skill => [skill.path, skill.text]))
  const problems = []
  for (const file of files) {
    const onDisk = alreadyRead.has(file.path)
      ? alreadyRead.get(file.path)
      : await fs.readFile(path.join(root, file.path), 'utf8').catch(() => null)
    if (onDisk === file.text) continue
    // A missing catalog is not a failure: the index reads the plugin sources
    // when the file is not there, so a checkout without it still names every
    // type. A catalog that is there and stale is the failure below, because the
    // index would trust it.
    if (onDisk === null && file.path === BUILTIN_REGISTERED_TYPES) continue
    problems.push({
      file: file.path,
      why:
        onDisk === null
          ? `${file.path} is generated from ${file.source} and is not on disk. Run "node bin/engine.mjs agent.skills" to write it — a dev server writes these at start-up only, so one already running will not`
          : `${file.path} does not match ${file.source} it is generated from. Every agent reads the stale copy. Run "node bin/engine.mjs agent.skills" to write it — a dev server writes these at start-up only, so one already running will not`
    })
  }
  const wanted = new Set(files.map(file => file.path))
  for (const skill of skillsOnDisk || (await generatedSkillsOnDisk(root))) {
    if (wanted.has(skill.path)) continue
    problems.push({
      file: skill.path,
      why: `${skill.path} is a generated skill no enabled guide in ${projectName(projectPath)} claims. It registers a plugin that is off or gone. Run "node bin/engine.mjs agent.skills" to remove it`
    })
  }
  return problems
}

/**
 * Guides the harness will never show, and plugins with no guide at all.
 *
 * A plugin author who omits `skill:` ships work no future agent finds, and
 * nothing today says so. A category the engine does not define, or none at all,
 * is the same kind of silence. These are warnings except where an author asked
 * for a skill and the generator would silently drop it — a dropped declaration
 * reads exactly like a plugin that never wanted one.
 */
export async function skillRegistrationProblems(root, projectPath, guides = null, skillsOnDisk = null) {
  const problems = []
  const enabled = await enabledCategories(root)
  const context = { enabled, projectPath }
  for (const guide of guides || (await pluginGuides(root, projectPath))) {
    problems.push(...guideProblems(guide, context))
  }

  for (const source of await pluginsWithoutGuide(root, projectPath)) {
    problems.push({
      warning: true,
      file: source,
      why: 'has no .agent.md guide, so it appears in no packet and no skill listing. Every command it registers is undiscoverable'
    })
  }

  problems.push(...(await manifestSkillProblems(root, skillsOnDisk)))
  return problems
}

/** Every listing problem one guide declares, in the order the checks read. */
function guideProblems(guide, { enabled, projectPath }) {
  const problems = []
  const { skill, category, description, triggers, match } = guide.frontmatter

  // A category the engine does not define registers nothing, and the listing
  // shows no sign of why: the guide is on disk and correct in every other way.
  if (category && !CATEGORIES.includes(category)) {
    problems.push({
      file: guide.fileFromRoot,
      why: `declares category ${JSON.stringify(category)}, which is not one of ${CATEGORIES.join(', ')}, so no skill is registered for it. Use one of them`
    })
  }

  // This is the set every agent of every session pays for, so a guide that
  // lands in it by omission is worth one line when it is written.
  if (listedForAgents(guide) && !category) {
    problems.push({
      warning: true,
      file: guide.fileFromRoot,
      why: `declares no category, so it registers as \`${DEFAULT_CATEGORY}\` and every agent of every session reads its listing. Add a category line`
    })
  }

  // An opt-out is a decision, not a broken declaration: the guide still
  // arrives in a packet when the task names the plugin. The two exceptions are
  // read here rather than below, because after this return nothing about the
  // guide is looked at again.
  if (!listedForAgents(guide)) {
    problems.push(...optOutProblems(guide, { description, triggers }))
    return problems
  }
  // So is a category this checkout keeps out of the listing. The rest of these
  // checks are about a registered listing, and this guide is not in one.
  if (!enabled.has(categoryOf(guide))) return problems
  // The listing is the engine's and does not change with the open project, so
  // a game that switches a builtin off is listing a command it does not have.
  if (guide.scope === 'engine' && !guide.enabled) {
    problems.push({
      warning: true,
      file: guide.fileFromRoot,
      why: `is listed as \`${skillNameFor(guide)}\` and ${projectName(projectPath)} switches it off, so this game lists a tool whose commands it does not have. Enable it, or expect an agent to try a command that is not there`
    })
    return problems
  }
  if (!guide.enabled) return problems

  if (skill && !SKILL_NAME.test(skill)) {
    problems.push({
      file: guide.fileFromRoot,
      why: `skill name ${JSON.stringify(skill)} is not a directory name, so no skill is registered. Use lower-case letters, digits and hyphens`
    })
  }

  // The description is the only thing that decides whether a skill is found,
  // and a derived one can only say what the plugin is. A guide worth reaching
  // for says when to reach for it, in its own words.
  if (listedForAgents(guide) && !description) {
    problems.push({
      warning: true,
      file: guide.fileFromRoot,
      why: 'declares no description, so its listing is derived from the guide body and says what the plugin is but never when to use it. Add a description line saying what it does and when to reach for it'
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

  return problems
}

/**
 * What a guide that opted out of the listing still gets wrong.
 *
 * Read before `guideProblems` returns, because an opt-out is otherwise the end
 * of the subject. Both of these are about text that only a listing can deliver
 * - the words reach an agent through the session listing and nowhere else.
 */
function optOutProblems(guide, { description, triggers }) {
  const problems = []

  // Agent tooling exists to be reached for, and this is the one folder category
  // whose whole job is an agent. An opt-out leaves it in the CLI alone: a
  // harness that picks skills by description never learns the tool is there, so
  // the work ships and no agent finds it. A visual or editor plugin opting out
  // is a decision about who reads it; an agents plugin doing so is a defect.
  if (guide.pluginCategory === 'agents') {
    problems.push({
      file: guide.fileFromRoot,
      why: 'is agent tooling that opts out of the listing with `skill: none`, so a harness that picks skills by description never learns it exists. Declare a category, or the work ships for no agent'
    })
  }

  if (description || triggers) {
    problems.push({
      warning: true,
      file: guide.fileFromRoot,
      why: `declares ${description ? 'a description' : 'trigger words'} and \`skill: none\`, so it is in no listing and the words reach nothing. Drop one of the two`
    })
  }

  return problems
}

/**
 * Manifest skill nodes the harness never sees.
 *
 * `agents/manifest.json` has a `skill` node kind, and those nodes reach an
 * agent only through a packet. A guide's `skill:` frontmatter is the one route
 * into the session listing, so a manifest skill is a skill in name only.
 */
async function manifestSkillProblems(root, skillsOnDisk = null) {
  const manifest = JSON.parse(await fs.readFile(path.join(root, MANIFEST), 'utf8').catch(() => '{"nodes":[]}'))
  const enabled = await enabledCategories(root)
  const registered = new Set((skillsOnDisk || (await generatedSkillsOnDisk(root))).map(skill => skill.name))
  return (manifest.nodes || [])
    .filter(node => node.kind === 'skill' && enabled.has(node.category || DEFAULT_CATEGORY))
    .filter(node => !registered.has(`${ENGINE}-${node.id}`))
    .map(node => ({
      warning: true,
      file: node.file || 'agents/manifest.json',
      why: `manifest node "${node.id}" is kind "skill" but is not in ${SKILL_DIRECTORY}, so no session lists it. Only an agent that ran agent.context with a matching word finds it`
    }))
}

/** Everything this module reports, for one call from `check`. */
export async function agentRegistrationProblems(root, projectPath) {
  // Read the guides once and hand the same list to both checks. Each one
  // compares against that same list, and reading every guide, its source and its
  // detail files once per check was half of what `check` spent its time on.
  //
  // A guide no longer has to name its plugin's commands: an instruction packet
  // prints every one of them, parsed from source as the packet is built. So the
  // check that read the guide looking for a missing verb is gone, and no check
  // is needed to replace it — a command reaches an agent whether or not the
  // guide ever mentions it.
  const guides = await pluginGuides(root, projectPath, { detail: false })
  // One listing of the generated skills on disk, handed to both checks. Each
  // wanted to know which generated skills are there, and each read every
  // SKILL.md to find out.
  const skillsOnDisk = await generatedSkillsOnDisk(root)
  return [
    ...(await generatedFileProblems(root, projectPath, guides, skillsOnDisk)),
    ...(await skillRegistrationProblems(root, projectPath, guides, skillsOnDisk))
  ]
}
