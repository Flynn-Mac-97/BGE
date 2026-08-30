/**
 * Put `engine/agent-registration.mjs` into `vite.config.js` and `bin/engine.mjs`.
 *
 * Both files were owned by another workflow when the module was written, so the
 * two edits are held here as exact anchors instead of being made. Each anchor
 * must appear exactly once or nothing is written, so a file that has moved on
 * fails loudly rather than being half-patched.
 *
 *   node agent-runs/registration-apply.mjs           # say what would change
 *   node agent-runs/registration-apply.mjs --write   # change it
 *
 * The dry run parses the patched text with `node --check`, so a run that
 * reports ready has already proved both files still parse.
 */
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const run = promisify(execFile)
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const WRITE = process.argv.includes('--write')

const edits = [
  {
    file: 'vite.config.js',
    what: 'import the module',
    from: `import { buildIndex as buildProjectIndex, problemsIn, fatal, walk, KIND, recordServer, forgetServer } from './engine/project-index.mjs'`,
    to: `import { buildIndex as buildProjectIndex, problemsIn, fatal, walk, KIND, recordServer, forgetServer } from './engine/project-index.mjs'
// The files an agent reads before it asks anything are written from the same
// module \`node bin/engine.mjs check\` compares them against, so a server start
// and a check cannot disagree about what current means.
import { writeGeneratedAgentFiles } from './engine/agent-registration.mjs'`
  },
  {
    file: 'vite.config.js',
    what: 'call the module instead of holding the generator',
    from: `/**
 * AGENTS.md is how a CLI that has never seen this project learns to drive it.
 * Written at server start so it can never drift from a stale checkout, and
 * never overwritten by hand-edits being lost — it is generated, say so in it.
 */
async function writeAgentDoc() {
  await fs.writeFile(path.join(ROOT, 'AGENTS.md'), AGENT_DOC, 'utf8')

  // Claude Code reads CLAUDE.md. Point at the same file rather than duplicating
  // it, and never clobber one the user already wrote.
  const claude = path.join(ROOT, 'CLAUDE.md')
  try { await fs.access(claude) } catch {
    await fs.writeFile(claude, 'See [AGENTS.md](AGENTS.md) — it is generated and always current.\\n', 'utf8')
  }

  await writeGuideSkills()
}

/**
 * An enabled plugin's guide can register as a HARNESS skill — an entry in the
 * skill listing every agent reads before its first tool call. Documentation
 * loses to that listing every time: five fresh agents in a row chose the
 * browser skill by name and never opened a file. A guide opts in with \`skill:\`
 * and \`description:\` frontmatter; the body written here is the guide itself.
 * Toggling the plugin off removes the skill at the next server start, because
 * this directory is cleared and rebuilt from enabled guides alone.
 */
async function writeGuideSkills() {
  const generated = path.join(ROOT, '.claude/skills')
  const plugins = await agentPlugins()
  const mine = new Set()
  for (const node of plugins) {
    if (!node.enabled) continue
    const guide = await fs.readFile(path.join(ROOT, node.scope === 'engine' ? node.file : path.join(PROJECT_DIRECTORY, node.file)), 'utf8').catch(() => '')
    const declared = guide.match(/^---\\s*\\n([\\s\\S]*?)\\n---/)?.[1]
    const skillName = declared?.match(/^skill:\\s*(.+)$/m)?.[1]?.trim()
    const description = declared?.match(/^description:\\s*(.+)$/m)?.[1]?.trim()
    if (!skillName || !description) continue
    mine.add(skillName)
    const body = guide.replace(/^---\\s*\\n[\\s\\S]*?\\n---\\s*/, '')
    await fs.mkdir(path.join(generated, skillName), { recursive: true })
    await fs.writeFile(path.join(generated, skillName, 'SKILL.md'),
      \`---\\nname: \${skillName}\\ndescription: \${description}\\n---\\n<!-- generated from \${node.file} at server start; edits are lost -->\\n\\n\${body}\`, 'utf8')
  }
  // Skills this generator wrote before but did not write now belong to guides
  // that were disabled or dropped — remove them, or a dead plugin stays
  // registered. Only generated skills are touched; a hand-written one has no
  // generated marker and is left alone.
  let names = []
  try { names = await fs.readdir(generated) } catch { return }
  for (const name of names) {
    if (mine.has(name)) continue
    const text = await fs.readFile(path.join(generated, name, 'SKILL.md'), 'utf8').catch(() => '')
    if (text.includes('<!-- generated from ')) await fs.rm(path.join(generated, name), { recursive: true, force: true })
  }
}

const AGENT_DOC = await fs.readFile(path.join(ROOT, 'agents/bootstrap.md'), 'utf8')`,
    to: `/**
 * AGENTS.md and the generated skill listing, written at server start.
 *
 * Both are read by an agent before it asks anything, and both are generated
 * from files in this checkout. The rule for writing them is in
 * \`engine/agent-registration.mjs\` so that \`node bin/engine.mjs check\` reports
 * them against the same rule, and a server start and a check cannot disagree
 * about what current means.
 *
 * The sources are read on every call, so editing \`agents/bootstrap.md\` while
 * the server runs updates AGENTS.md.
 */
async function writeAgentDoc() {
  await writeGeneratedAgentFiles(ROOT, PROJECT_DIRECTORY)
}`
  },
  {
    file: 'bin/engine.mjs',
    what: 'report generated files that no longer match their source',
    from: `  const failed = await pluginImportFailures(CHECKOUT, PROJECT)
  const problems = [...pluginProblems(failed), ...problemsIn(await buildIndex(PROJECT))]`,
    to: `  const failed = await pluginImportFailures(CHECKOUT, PROJECT)
  // A generated file behind its source is read once, at session start, by every
  // agent for the whole session. Reported against the same module the dev
  // server writes them with, so a pass here means a fresh agent will read what
  // the sources say.
  const { agentRegistrationProblems } = await import('../engine/agent-registration.mjs')
  const problems = [
    ...pluginProblems(failed),
    ...await agentRegistrationProblems(CHECKOUT, path.basename(PROJECT)),
    ...problemsIn(await buildIndex(PROJECT))
  ]`
  }
]

const patched = new Map()
const wrong = []

for (const edit of edits) {
  const text = patched.get(edit.file) ?? await fs.readFile(path.join(ROOT, edit.file), 'utf8')
  const count = text.split(edit.from).length - 1
  console.log(`${count === 1 ? 'ready ' : 'WRONG '} ${edit.file}: ${edit.what} (anchor found ${count} time${count === 1 ? '' : 's'})`)
  if (count !== 1) { wrong.push(edit); continue }
  patched.set(edit.file, text.replace(edit.from, edit.to))
}

if (wrong.length) {
  console.log(`\n${wrong.length} anchor(s) no longer match. Nothing written. Re-read the file and update this script.`)
  process.exit(1)
}

// Parse what would be written before offering to write it. A patch that lands
// and does not parse takes the dev server and every CLI command with it.
const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'registration-apply-'))
for (const [file, text] of patched) {
  const copy = path.join(scratch, path.basename(file))
  await fs.writeFile(copy, text, 'utf8')
  try {
    await run(process.execPath, ['--check', copy])
    console.log(`parses  ${file}`)
  } catch (error) {
    console.log(`SYNTAX  ${file}\n${error.stderr || error.message}`)
    wrong.push(file)
  }
}
await fs.rm(scratch, { recursive: true, force: true })
if (wrong.length) process.exit(1)

if (!WRITE) {
  console.log('\nDry run. Pass --write to apply. Then run:')
  console.log('  node bin/engine.mjs check')
  console.log('  node agent-runs/registration-check.mjs')
  process.exit(0)
}

for (const [file, text] of patched) {
  await fs.writeFile(path.join(ROOT, file), text, 'utf8')
  console.log(`wrote   ${file}`)
}
