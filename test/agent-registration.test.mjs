import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  agentRegistrationProblems,
  generatedAgentFiles,
  writeGeneratedAgentFiles
} from '../engine/agent-registration.mjs'

/**
 * Which guides become skills is decided by `skillCategories` in
 * `agents/manifest.json`, and the cost of getting it wrong is paid at session
 * start by every agent. Nothing else fails when the switch is ignored, so the
 * switch is held here.
 */

/** One plugin guide, with a description and the category under test. */
function guide(name, category) {
  const categoryLine = category === null ? '' : `category: ${category}\n`
  return `---\ndescription: ${name} does one thing, and is reached for when that is the job.\n${categoryLine}triggers: ${name}\n---\n\n# ${name}\n\n- One rule about ${name}.\n`
}

/** A checkout with a manifest, the AGENTS.md source, and the guides given. */
async function checkout(guides, categories) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-registration-'))
  await fs.mkdir(path.join(root, 'plugins/builtin'), { recursive: true })
  await fs.mkdir(path.join(root, 'agents'), { recursive: true })
  await fs.writeFile(path.join(root, 'agents/bootstrap.md'), '# Bootstrap\n\nRules.\n')
  await fs.writeFile(path.join(root, 'agents/manifest.json'),
    JSON.stringify({ version: 2, skillCategories: categories, nodes: [] }))
  for (const [name, category] of Object.entries(guides)) {
    await fs.writeFile(path.join(root, `plugins/builtin/${name}.agent.md`), guide(name, category))
    await fs.writeFile(path.join(root, `plugins/builtin/${name}.js`), `export default { name: '${name}' }\n`)
  }
  return root
}

const skillPaths = files => files.map(file => file.path)
const skillText = async (root, name) =>
  fs.readFile(path.join(root, `.claude/skills/glass-${name}/SKILL.md`), 'utf8').catch(() => null)

test('a category that is off registers no skill, and comes back when switched on', async () => {
  const root = await checkout({ alpha: 'core', bravo: 'gameplay' }, { core: true, gameplay: false })

  const written = skillPaths(await generatedAgentFiles(root, 'project'))
  assert.ok(written.includes('.claude/skills/glass-alpha/SKILL.md'), 'the always-on category registers')
  assert.ok(!written.includes('.claude/skills/glass-bravo/SKILL.md'), 'a category that is off registers nothing')

  await writeGeneratedAgentFiles(root, 'project')
  assert.equal(await skillText(root, 'bravo'), null, 'nothing on disk for a category that is off')

  await fs.writeFile(path.join(root, 'agents/manifest.json'),
    JSON.stringify({ version: 2, skillCategories: { core: true, gameplay: true }, nodes: [] }))
  await writeGeneratedAgentFiles(root, 'project')
  assert.ok(await skillText(root, 'bravo'), 'switching the category on writes its skill')

  await fs.writeFile(path.join(root, 'agents/manifest.json'),
    JSON.stringify({ version: 2, skillCategories: { core: true, gameplay: false }, nodes: [] }))
  await writeGeneratedAgentFiles(root, 'project')
  assert.equal(await skillText(root, 'bravo'), null, 'switching it off removes the skill it left behind')
  assert.ok(await skillText(root, 'alpha'), 'the always-on skill stays')
})

test('a category the engine does not define is a failure, not a silent omission', async () => {
  const root = await checkout({ alpha: 'core', charlie: 'wildwest' }, { core: true, gameplay: false })
  await writeGeneratedAgentFiles(root, 'project')

  const problems = await agentRegistrationProblems(root, 'project')
  const undefinedCategory = problems.filter(problem => !problem.warning && problem.file.endsWith('charlie.agent.md'))
  assert.equal(undefinedCategory.length, 1, 'a category outside the vocabulary registers nothing and says so')
  assert.match(undefinedCategory[0].why, /wildwest/)
  assert.equal(await skillText(root, 'charlie'), null, 'and it registers no skill')
})

test('a guide with no category is a warning, and registers as core', async () => {
  const root = await checkout({ alpha: null }, { core: true })
  await writeGeneratedAgentFiles(root, 'project')

  const problems = await agentRegistrationProblems(root, 'project')
  const unclassified = problems.filter(problem => problem.warning && problem.file.endsWith('alpha.agent.md'))
  assert.equal(unclassified.length, 1, 'an unclassified guide joins the set every session pays for, and says so')
  assert.ok(await skillText(root, 'alpha'), 'and it still registers, so nothing an agent had is lost')
})

test('a category that is off is a decision, so it is reported as no problem at all', async () => {
  const root = await checkout({ alpha: 'core', bravo: 'gameplay' }, { core: true, gameplay: false })
  await writeGeneratedAgentFiles(root, 'project')

  const problems = await agentRegistrationProblems(root, 'project')
  assert.deepEqual(problems, [], 'a guide kept out of the listing by its category is quiet')
})

test('no manifest block registers the always-on category alone', async () => {
  const root = await checkout({ alpha: 'core', bravo: 'gameplay' }, null)
  const written = skillPaths(await generatedAgentFiles(root, 'project'))
  assert.ok(written.includes('.claude/skills/glass-alpha/SKILL.md'))
  assert.ok(!written.includes('.claude/skills/glass-bravo/SKILL.md'))
})
