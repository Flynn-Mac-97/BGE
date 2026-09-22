import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { probeText } from '../tools/dream/candidate.mjs'

const CHECKOUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const TEMPLATE = path.join(CHECKOUT, 'tools/dream/prompts/candidate.md')
const BUILDER = path.join(CHECKOUT, 'tools/dream/candidate.mjs')

/** Every placeholder the candidate builder fills, read from its source. */
async function filledPlaceholders() {
  const source = await fs.readFile(BUILDER, 'utf8')
  return new Set([...source.matchAll(/replaceAll\('\{\{(\w+)\}\}'/g)].map(match => match[1]))
}

/** Every placeholder the template leaves for the builder, in order of first use. */
function templatePlaceholders(template) {
  return [...new Set([...template.matchAll(/\{\{(\w+)\}\}/g)].map(match => match[1]))]
}

/** The prompt an agent reads: the template with each placeholder filled. */
async function buildPrompt() {
  const template = await fs.readFile(TEMPLATE, 'utf8')
  return templatePlaceholders(template)
    .reduce((text, name) => text.replaceAll(`{{${name}}}`, `sample ${name}`), template)
}

test('every placeholder in the template is one the candidate builder fills', async () => {
  const template = await fs.readFile(TEMPLATE, 'utf8')
  const filled = await filledPlaceholders()
  for (const name of templatePlaceholders(template)) {
    assert.ok(filled.has(name), `the template uses {{${name}}} but the builder never fills it`)
  }
})

test('a built prompt tells the candidate how to classify a failed attempt', async () => {
  const prompt = await buildPrompt()

  assert.match(prompt, /## Learn from successes and failures/, 'the classification section is missing')
  assert.match(prompt, /flawed core idea/, 'the flawed-idea class is missing')
  assert.match(prompt, /bug, a bad parameter, or a slip/, 'the salvageable-failure class is missing')
  assert.match(prompt, /found the fault in the code/, 'the candidate is not told to locate the bug in the code')
  assert.match(prompt, /guessed it from the report/, 'the report is still taken as evidence of the fault')
  assert.match(prompt, /specific fix in hand/, 'the candidate is not told to arrive with a fix')
})

test('a built prompt keeps the packet, the history and the exploration rules', async () => {
  const prompt = await buildPrompt()

  assert.match(prompt, /sample PACKET/, 'the engine packet section is missing')
  assert.match(prompt, /sample HISTORY/, 'the history block is missing')
  assert.match(prompt, /sample PROBE/, 'the frame-probe section is missing')
  assert.match(prompt, /## Read the complete history first/, 'the complete-history rule is missing')
  assert.match(prompt, /Trust the measured result over what the/, 'the measured result is not preferred over the claim')
  assert.match(prompt, /## Do not converge into a local optimum/, 'the local-optimum rule is missing')
  assert.match(prompt, /untried combination of pieces that already worked/, 'a structurally different mechanism is not preferred')
  assert.match(prompt, /## What counts as a new proposal/, 'the new-proposal rule is missing')
  assert.doesNotMatch(prompt, /\{\{\w+\}\}/, 'a placeholder was left unfilled')
})

test('a built prompt says a cut-off attempt is not a validated result', async () => {
  const prompt = await buildPrompt()

  assert.match(prompt, /status <name>/, 'the cut-off mark is not explained')
  assert.match(prompt, /unfinished claim, not a validated result/, 'an unfinished report is not marked as a claim')
  assert.match(prompt, /Only the evaluator's `measures` are\s+evidence that a change worked/, 'the measures are not named as the evidence')
})

test('the frame probe is advertised only when the setup prices frames', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dream-probe-text-'))
  await fs.writeFile(path.join(directory, 'setup.mjs'), 'await helpers.browserFrames(checkout, project, {})', 'utf8')
  const priced = await probeText(directory, 'the-game')
  await fs.writeFile(path.join(directory, 'setup.mjs'), 'await helpers.engineProcess(checkout, project, [])', 'utf8')
  const unpriced = await probeText(directory, 'the-game')
  await fs.writeFile(path.join(directory, 'setup.mjs'), 'nothing here', 'utf8')
  const missing = await probeText(path.join(directory, 'absent'), 'the-game')
  await fs.rm(directory, { recursive: true, force: true })

  assert.match(priced, /## Measuring a frame cost quickly/, 'the priced setup got no probe section')
  assert.match(priced, /node tools\/dream\/quick-probe\.mjs --project "the-game"/, 'the exact probe command is missing')
  assert.match(priced, /exploratory/, 'the probe is not marked exploratory')
  assert.equal(unpriced, '', 'a setup that does not price frames got the probe')
  assert.equal(missing, '', 'a missing setup got the probe')
})
