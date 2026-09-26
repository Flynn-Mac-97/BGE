/**
 * The project gate: the kernel gate's four checks over a game's own code.
 *
 * A project opts in with `"codeGate": ["plugins", "types", "tests"]` in its
 * `game.json`: the top-level directories whose JavaScript is held to
 * `agents/code-style.md`. With no list, the gate checks nothing, so a game
 * written before the gate still passes `check`.
 *
 * Over those directories: Prettier with the kernel's settings, ESLint with the
 * kernel's style rules, Trellis with a budget of zero eroded functions,
 * duplicated blocks and import cycles, and Codemap, which fails a file it
 * cannot parse or a relative import it cannot resolve.
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import javascript from '@eslint/js'
import { ESLint } from 'eslint'
import prettier from 'prettier'
import prettierSettings from '../prettier.config.mjs'
import { styleConfig } from '../eslint.config.mjs'

/** The Trellis metrics the gate reads, each with a budget of zero. */
const ZERO_BUDGET = {
  'erosion.eroded-count.production': 'eroded functions',
  'duplication.groups.production': 'duplicated blocks',
  'import-cycle.groups': 'import cycles'
}

/** The directories a project's `game.json` puts under the gate; empty when it names none. */
function gatedDirectories(project) {
  const manifest = JSON.parse(fs.readFileSync(path.join(project, 'game.json'), 'utf8'))
  return Array.isArray(manifest.codeGate) ? manifest.codeGate : []
}

/** Every top-level directory of the project the gate does not cover. */
function ungatedDirectories(project, gated) {
  return fs
    .readdirSync(project, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && !gated.includes(entry.name))
    .map(entry => entry.name)
}

/** Every JavaScript file under the gated directories. */
function gatedFiles(project, gated) {
  return gated.flatMap(directory =>
    fs
      .readdirSync(path.join(project, directory), { recursive: true })
      .filter(file => /\.m?js$/.test(file))
      .map(file => path.join(directory, file).split(path.sep).join('/'))
  )
}

/** One problem per file Prettier would change. */
async function formatProblems(project, files) {
  const problems = []
  for (const file of files) {
    const source = fs.readFileSync(path.join(project, file), 'utf8')
    const isFormatted = await prettier.check(source, { ...prettierSettings, filepath: file })
    if (!isFormatted) problems.push({ file, why: 'not formatted to prettier.config.mjs' })
  }
  return problems
}

/** One problem per style-rule message. */
async function lintProblems(project, files) {
  const eslint = new ESLint({
    cwd: project,
    overrideConfigFile: true,
    overrideConfig: [javascript.configs.recommended, styleConfig(['**/*.js', '**/*.mjs'])]
  })
  const results = await eslint.lintFiles(files)
  return results.flatMap(result =>
    result.messages.map(message => ({
      file: path.relative(project, result.filePath).split(path.sep).join('/'),
      why: `line ${message.line}: ${message.message} (${message.ruleId ?? 'parse'}) — agents/code-style.md`
    }))
  )
}

/** One problem per Trellis metric above zero, naming the files it found. */
async function structureProblems(checkout, project, gated) {
  const vendor = pathToFileURL(path.join(checkout, 'vendor', 'trellis') + path.sep)
  const { auditWorkspace } = await import(new URL('audit.mjs', vendor))
  const { loadAuditConfig } = await import(new URL('config.mjs', vendor))
  const config = await loadAuditConfig(project)
  config.source.exclude = [...config.source.exclude, ...ungatedDirectories(project, gated).map(name => `${name}/**`)]
  const report = await auditWorkspace(project, { config })
  return Object.entries(ZERO_BUDGET)
    .filter(([metric]) => report.metrics[metric].value > 0)
    .map(([metric, label]) => ({
      file: 'game.json',
      why: `Trellis: ${report.metrics[metric].value} ${label}, budget 0\n${findingLines(report).join('\n')}`
    }))
}

/** Each Trellis finding as one line: where it is and what it is. */
const findingLines = report =>
  report.findings.map(
    finding => `  ${finding.path}:${finding.range?.start.line ?? ''} ${finding.kind} ${finding.summary}`
  )

/** One problem per file Codemap cannot parse and per relative import it cannot resolve. */
async function codemapProblems(checkout, project, gated) {
  const pluginRoot = pathToFileURL(path.join(checkout, 'plugins', 'builtin') + path.sep)
  const { makeSourceReader } = await import(new URL('plugin-master/source-facts.js', pluginRoot))
  const { buildCodemap } = await import(new URL('codemap/scan.js', pluginRoot))
  const ignored = new Set(['node_modules', ...ungatedDirectories(project, gated)])
  const codemap = await buildCodemap(project, await makeSourceReader(), { ignored })
  return codemap.files.flatMap(fileMap => {
    if (fileMap.parseErrors) return [{ file: fileMap.file, why: 'Codemap cannot parse this file' }]
    return fileMap.imports
      .filter(record => record.source.startsWith('.') && !record.resolved)
      .map(record => ({
        file: fileMap.file,
        why: `line ${record.line} imports ${record.source}, which Codemap cannot resolve`
      }))
  })
}

/**
 * Every project gate problem, as `{ file, why }` records with paths from the
 * project root. An empty list means the gated code passes, or none is gated.
 */
export async function projectGateProblems(checkout, project) {
  const gated = gatedDirectories(project)
  if (!gated.length) return []
  const files = gatedFiles(project, gated)
  const groups = await Promise.all([
    formatProblems(project, files),
    lintProblems(project, files),
    structureProblems(checkout, project, gated),
    codemapProblems(checkout, project, gated)
  ])
  return groups.flat()
}
