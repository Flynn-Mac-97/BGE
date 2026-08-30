/**
 * Prove every failure `engine/agent-registration.mjs` reports, on a built tree.
 *
 * The real checkout shows only the cases that happen to exist today, and making
 * one drift would mean editing `plugins/builtin/`, which another workflow owns.
 * This builds a small root under the system temp directory, writes the faults
 * on purpose, and deletes it.
 *
 *   node agent-runs/registration-fixture.mjs
 *
 * Exits 1 if any case does not report what it should, so it is a test.
 */
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
  generatedFileProblems,
  skillRegistrationProblems,
  writeGeneratedAgentFiles
} from '../engine/agent-registration.mjs'

const fatal = problems => problems.filter(problem => !problem.warning)
const has = (problems, file, word) => problems.some(problem => problem.file === file && problem.why.includes(word))

const write = async (root, rel, text) => {
  const absolute = path.join(root, rel)
  await fs.mkdir(path.dirname(absolute), { recursive: true })
  await fs.writeFile(absolute, text, 'utf8')
}

const guide = (fields, body) =>
  `---\n${Object.entries(fields).map(([key, value]) => `${key}: ${value}`).join('\n')}\n---\n\n${body}\n`

const plugin = name => `export default { name: '${name}', setup() {} }\n`

/** A root with one good plugin and one of every fault. */
async function build() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'registration-'))
  await write(root, 'agents/bootstrap.md', '# Driving this engine\n\nRead the packet.\n')
  await write(root, 'agents/manifest.json', JSON.stringify({
    nodes: [{ id: 'blender-3d', kind: 'skill', file: 'agents/skills/blender-3d/SKILL.md' }]
  }, null, 2))
  await write(root, 'project/game.json', JSON.stringify({ plugins: { disabled: ['Retired'] } }))

  // Registers correctly. Nothing should be reported about it.
  await write(root, 'plugins/builtin/good.js', plugin('Good'))
  await write(root, 'plugins/builtin/good.agent.md',
    guide({ skill: 'good-skill', description: 'What Good answers.' }, '# Good'))

  // Asked for a skill and would be dropped without a word.
  await write(root, 'plugins/builtin/no-description.js', plugin('No Description'))
  await write(root, 'plugins/builtin/no-description.agent.md',
    guide({ skill: 'no-description' }, '# No Description'))

  // A skill name that is not a directory name.
  await write(root, 'plugins/builtin/bad-name.js', plugin('Bad Name'))
  await write(root, 'plugins/builtin/bad-name.agent.md',
    guide({ skill: 'Bad Name!', description: 'x' }, '# Bad Name'))

  // Claims task words, reachable only through agent.context.
  await write(root, 'plugins/builtin/triggers-only.js', plugin('Triggers Only'))
  await write(root, 'plugins/builtin/triggers-only.agent.md',
    guide({ triggers: 'look, colour' }, '# Triggers Only'))

  // Half the frontmatter.
  await write(root, 'plugins/builtin/description-only.js', plugin('Description Only'))
  await write(root, 'plugins/builtin/description-only.agent.md',
    guide({ description: 'x' }, '# Description Only'))

  // A guide with no plugin and no match: it attaches to nothing.
  await write(root, 'plugins/builtin/orphan-guide.agent.md', guide({}, '# Orphan Guide'))

  // A guide with no plugin that declares match, as claude-code.agent.md does.
  await write(root, 'plugins/builtin/documented-tool.agent.md',
    guide({ match: 'CLAUDE.md .claude/**' }, '# Documented Tool'))

  // A plugin nobody wrote a guide for.
  await write(root, 'project/plugins/undocumented.js', plugin('Undocumented'))

  // Disabled, so its faults are not this project's business.
  await write(root, 'plugins/builtin/retired.js', plugin('Retired'))
  await write(root, 'plugins/builtin/retired.agent.md',
    guide({ triggers: 'retired' }, '# Retired'))

  return root
}

const failures = []
const expect = (ok, said) => { console.log(`  ${ok ? 'pass' : 'FAIL'}  ${said}`); if (!ok) failures.push(said) }

const root = await build()
console.log(`root=${root}\n`)

console.log('before anything is generated:')
let drift = await generatedFileProblems(root, 'project')
for (const problem of drift) console.log(`  FAIL     ${problem.file}\n            ${problem.why}`)
expect(has(drift, 'AGENTS.md', 'not on disk'), 'AGENTS.md missing is a failure')
expect(has(drift, '.claude/skills/good-skill/SKILL.md', 'not on disk'), 'a missing skill file is a failure')
expect(fatal(drift).length === 2, 'both are failures, not warnings')

console.log('\nafter writeGeneratedAgentFiles:')
console.log(`  wrote ${(await writeGeneratedAgentFiles(root, 'project')).join(', ')}`)
drift = await generatedFileProblems(root, 'project')
expect(drift.length === 0, 'nothing drifts once written')
expect(
  (await fs.readFile(path.join(root, 'CLAUDE.md'), 'utf8')).startsWith('See [AGENTS.md]'),
  'CLAUDE.md is written when absent')

console.log('\nguide edited, no dev server started — this is p154:')
await write(root, 'plugins/builtin/good.agent.md',
  guide({ skill: 'good-skill', description: 'What Good answers.' }, '# Good\n\nA rule added later.'))
drift = await generatedFileProblems(root, 'project')
for (const problem of drift) console.log(`  FAIL     ${problem.file}\n            ${problem.why}`)
expect(has(drift, '.claude/skills/good-skill/SKILL.md', 'does not match'), 'a stale skill file is a failure')

console.log('\nhand-written skill beside the generated ones:')
await write(root, '.claude/skills/hand-written/SKILL.md', '---\nname: hand-written\n---\nMine.\n')
await writeGeneratedAgentFiles(root, 'project')
expect((await generatedFileProblems(root, 'project')).length === 0, 'writing again clears the drift')
expect(
  await fs.access(path.join(root, '.claude/skills/hand-written/SKILL.md')).then(() => true, () => false),
  'a hand-written skill is left alone')

console.log('\nplugin disabled after its skill was written:')
await write(root, 'project/game.json', JSON.stringify({ plugins: { disabled: ['Retired', 'Good'] } }))
drift = await generatedFileProblems(root, 'project')
for (const problem of drift) console.log(`  FAIL     ${problem.file}\n            ${problem.why}`)
expect(has(drift, '.claude/skills/good-skill/SKILL.md', 'no enabled guide'), 'a skill for a disabled plugin is a failure')
await write(root, 'project/game.json', JSON.stringify({ plugins: { disabled: ['Retired'] } }))

console.log('\nregistration:')
const registration = await skillRegistrationProblems(root, 'project')
for (const problem of registration) console.log(`  ${problem.warning ? 'warning' : 'FAIL   '}  ${problem.file}\n            ${problem.why}`)
expect(has(fatal(registration), 'plugins/builtin/no-description.agent.md', 'no description'), 'skill without description is a failure')
expect(has(fatal(registration), 'plugins/builtin/bad-name.agent.md', 'not a directory name'), 'an unusable skill name is a failure')
expect(has(registration, 'plugins/builtin/triggers-only.agent.md', 'trigger words but no skill'), 'triggers without a skill warn')
expect(has(registration, 'plugins/builtin/description-only.agent.md', 'description with no skill'), 'a description without a skill warns')
expect(has(registration, 'plugins/builtin/orphan-guide.agent.md', 'declares no match'), 'a guide matching nothing warns')
expect(has(registration, 'project/plugins/undocumented.js', 'no .agent.md guide'), 'a plugin with no guide warns')
expect(has(registration, 'agents/skills/blender-3d/SKILL.md', 'not in .claude/skills'), 'a manifest skill node warns')
expect(!registration.some(problem => problem.file.includes('good.agent.md')), 'a correct guide is not reported')
expect(!registration.some(problem => problem.file.includes('retired')), 'a disabled plugin is not reported')
expect(!registration.some(problem => problem.file.includes('documented-tool')), 'a guide with match and no plugin is not reported')

await fs.rm(root, { recursive: true, force: true })
console.log(`\n${failures.length ? `${failures.length} case(s) wrong` : 'every case reports what it should'}`)
process.exit(failures.length ? 1 : 0)
