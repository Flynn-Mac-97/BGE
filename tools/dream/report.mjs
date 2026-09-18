/**
 * What a run says about itself, as a document and as pictures.
 *
 * A run is a sequence of attempts against a frozen measure, and the numbers
 * alone do not say what was tried, why a candidate was kept, or whether the
 * measure can tell a working target from a broken one. So after every round the
 * loop rewrites one markdown document and two SVG pictures beside the records.
 *
 * The document is written for a reader who was not there: the target, the
 * checks, the control, every attempt, and the winner's diff. The pictures are
 * the two the paper draws — a score against attempts, and the lineage of who
 * descended from whom.
 *
 * SVG by hand, with no dependency and no randomness: a picture that needs a
 * browser to be generated is a picture an agent cannot read.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PRICING, costBands, formatRmb, sumCosts } from './pricing.mjs'

const CHECKOUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

/**
 * One record, parsed from text that may carry a byte-order mark.
 *
 * A record edited by hand or by a tool that writes a BOM — PowerShell's
 * `Set-Content -Encoding utf8` does — is otherwise unreadable to `JSON.parse`,
 * and a reader that swallows the error reports a different record instead of
 * reporting the problem. That is how a run whose status file had a BOM came to
 * be shown as the other loop.
 */
export function parseRecord(text) {
  return JSON.parse(String(text).replace(/^\uFEFF/, ''))
}

/** Read every record a run wrote, oldest first. */
export async function readRun(runDirectory) {
  const read = async file => parseRecord(await fs.readFile(path.join(runDirectory, file), 'utf8'))
  const optional = async file => {
    try {
      return await read(file)
    } catch {
      return null
    }
  }

  const rounds = []
  const roundsDirectory = path.join(runDirectory, 'rounds')
  const names = await fs.readdir(roundsDirectory).catch(() => [])
  for (const name of names.sort()) {
    const directory = path.join(roundsDirectory, name)
    const files = await fs.readdir(directory).catch(() => [])
    const candidates = []
    for (const file of files.filter(file => file.endsWith('.json') && file !== 'round.json').sort()) {
      candidates.push(parseRecord(await fs.readFile(path.join(directory, file), 'utf8')))
    }
    rounds.push({
      name,
      round: Number(name.replace(/^r/, '')),
      candidates,
      record: parseRecord(await fs.readFile(path.join(directory, 'round.json'), 'utf8').catch(() => 'null'))
    })
  }

  return {
    target: await optional('target.json'),
    check: await optional('setup-check.json'),
    design: await optional('design.json'),
    rounds,
    winner: await optional('winner.json'),
    status: await optional('run.json')
  }
}

/**
 * What the run spent, in RMB.
 *
 * Summed from the token records on disk rather than from a stored total, so a
 * run started before this existed still shows a cost, and a price change can be
 * applied to an old run by reading it again.
 */
export function costOfRun(run) {
  const candidates = []
  for (const round of run.rounds) {
    for (const candidate of round.candidates) candidates.push(costBands(candidate.tokens ?? null))
  }
  const design = run.design?.tokens ? costBands(run.design.tokens) : null
  return {
    design,
    candidates: sumCosts(candidates),
    total: sumCosts([...(design ? [design] : []), ...candidates])
  }
}

/** A number for a table, with the sign and digits kept out of the way. */
const number = value => (typeof value === 'number' ? String(Math.round(value * 1e6) / 1e6) : '—')

/** SVG text and attributes escaped, so a reason containing `<` cannot break the picture. */
const escape = text => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/**
 * Score against attempts.
 *
 * Every scored candidate is a point, the running best is a step line, and the
 * target as it stood is a dashed floor. A refused candidate is drawn hollow:
 * it was tried, it cost something, and it bought nothing.
 */
export function svgImprovement({ baseline, points, width = 900, height = 320 }) {
  const left = 70
  const right = 20
  const top = 24
  const bottom = 46
  const values = [baseline, ...points.filter(point => point.scored).map(point => point.value)]
  const highest = Math.max(...values)
  const lowest = Math.min(...values)
  const span = highest - lowest || 1
  const x = index => left + (points.length < 2 ? 0 : (index / (points.length - 1)) * (width - left - right))
  const y = value => top + (1 - (value - lowest) / span) * (height - top - bottom)

  const grid = [0, 0.25, 0.5, 0.75, 1].map(fraction => {
    const value = lowest + fraction * span
    return `<line x1="${left}" y1="${y(value).toFixed(1)}" x2="${width - right}" y2="${y(value).toFixed(1)}" stroke="#e6e6e6"/>`
      + `<text x="${left - 8}" y="${(y(value) + 4).toFixed(1)}" text-anchor="end" font-size="11" fill="#777">${value.toFixed(3)}</text>`
  }).join('')

  let best = baseline
  let running = ''
  points.forEach((point, index) => {
    if (point.scored && point.value > best) best = point.value
    running += `${index === 0 ? 'M' : 'L'}${x(index).toFixed(1)},${y(best).toFixed(1)}`
  })
  if (!points.length) running = `M${left},${y(baseline).toFixed(1)}`

  const markers = points.map((point, index) => {
    const kept = point.scored && point.best === true
    return `<circle cx="${x(index).toFixed(1)}" cy="${y(point.scored ? point.value : baseline).toFixed(1)}" r="${kept ? 5 : 3.5}" `
      + `fill="${point.scored ? (kept ? '#1a7f37' : '#8a8a8a') : '#ffffff'}" stroke="${point.scored ? '#1a7f37' : '#c0392b'}" stroke-width="1.5">`
      + `<title>${escape(point.id)}: ${point.scored ? `value ${number(point.value)}` : `refused — ${point.reason ?? 'no reason given'}`}</title></circle>`
  }).join('')

  const footer = `baseline ${number(baseline)} · ${points.filter(point => point.scored).length} scored of ${points.length} attempts`

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" font-family="ui-monospace, monospace">`
    + `<rect width="${width}" height="${height}" fill="#ffffff"/>`
    + grid
    + `<line x1="${left}" y1="${y(baseline).toFixed(1)}" x2="${width - right}" y2="${y(baseline).toFixed(1)}" stroke="#c0392b" stroke-dasharray="5 4"/>`
    + `<path d="${running}" fill="none" stroke="#1a7f37" stroke-width="2"/>`
    + markers
    + `<text x="${left}" y="${height - 16}" font-size="12" fill="#333">attempts, in the order they ran</text>`
    + `<text x="${width - right}" y="${height - 16}" text-anchor="end" font-size="12" fill="#333">${escape(footer)}</text>`
    + `<text x="${left}" y="14" font-size="12" fill="#333">score</text>`
    + `</svg>\n`
}

/**
 * Who descended from whom.
 *
 * Each candidate is a node; an edge runs from the version it started from. The
 * baseline is the root. A candidate that beat its parent is green and becomes a
 * parent itself; one that did not is a leaf, which is what makes the picture
 * say where the search went and where it stopped going.
 */
export function svgLineage({ baseline, nodes, width = 900, height = 420 }) {
  // The target is a node too, at depth zero. Without it a candidate that
  // descends from the target directly would have nothing to hang from, and the
  // first column would draw on top of the root.
  const root = { id: 'target', depth: 0, root: true, scored: true, value: baseline }
  const all = [root, ...nodes.map(node => ({ ...node, depth: node.depth ?? 1 }))]

  const columns = new Map()
  for (const node of all) {
    if (!columns.has(node.depth)) columns.set(node.depth, [])
    columns.get(node.depth).push(node)
  }
  const depths = [...columns.keys()].sort((left, right) => left - right)
  const columnWidth = depths.length > 1 ? (width - 200) / (depths.length - 1) : 0

  const placed = new Map()
  for (const depth of depths) {
    const column = columns.get(depth)
    const spacing = (height - 100) / column.length
    column.forEach((node, index) => {
      placed.set(node.id, { x: 100 + depth * columnWidth, y: 70 + spacing * (index + 0.5) })
    })
  }

  const edges = nodes
    .map(node => {
      const from = placed.get(node.parent ?? 'target')
      const to = placed.get(node.id)
      if (!from || !to) return ''
      const mid = (from.x + to.x) / 2
      return `<path d="M${from.x.toFixed(1)},${from.y.toFixed(1)} C${mid.toFixed(1)},${from.y.toFixed(1)} ${mid.toFixed(1)},${to.y.toFixed(1)} ${to.x.toFixed(1)},${to.y.toFixed(1)}" `
        + `fill="none" stroke="#bbb" stroke-width="1.5"/>`
    })
    .join('')

  const at = placed.get('target')
  const rootMark = `<g><circle cx="${at.x.toFixed(1)}" cy="${at.y.toFixed(1)}" r="6" fill="#333"/>`
    + `<text x="${(at.x + 10).toFixed(1)}" y="${(at.y + 4).toFixed(1)}" font-size="11" fill="#333">the target as it stands ${escape(number(baseline))}</text></g>`

  const drawn = nodes.map(node => {
    const where = placed.get(node.id)
    const kept = node.best === true
    return `<g><circle cx="${where.x.toFixed(1)}" cy="${where.y.toFixed(1)}" r="${kept ? 7 : 5}" fill="${node.scored ? (kept ? '#1a7f37' : '#8a8a8a') : '#ffffff'}" stroke="${node.scored ? '#1a7f37' : '#c0392b'}" stroke-width="1.5">`
      + `<title>${escape(node.id)}: ${node.scored ? `value ${number(node.value)}` : 'refused'}</title></circle>`
      + `<text x="${(where.x + 10).toFixed(1)}" y="${(where.y + 4).toFixed(1)}" font-size="11" fill="#333">${escape(node.id)} ${node.scored ? number(node.value) : 'refused'}</text></g>`
  }).join('')

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" font-family="ui-monospace, monospace">`
    + `<rect width="${width}" height="${height}" fill="#ffffff"/>`
    + edges + rootMark + drawn
    + `<text x="12" y="${height - 10}" font-size="12" fill="#333">every candidate descends from the best version before it; a refused one is a leaf</text>`
    + `</svg>\n`
}

/** Every attempt in the run, in order, with the lineage the pictures need. */
export function attemptsOf(run) {
  const attempts = []
  for (const round of run.rounds) {
    for (const candidate of round.candidates) {
      attempts.push({
        id: candidate.id,
        round: round.round,
        parent: candidate.parent ?? 'target',
        depth: candidate.depth ?? 0,
        scored: candidate.verdict === 'scored',
        best: candidate.best === true,
        value: candidate.value ?? 0,
        reason: candidate.reason ?? null,
        measures: candidate.measures ?? null,
        tokens: candidate.tokens?.totalTokens ?? null,
        cost: costBands(candidate.tokens ?? null),
        durationMs: candidate.durationMs ?? null,
        report: candidate.report ?? null
      })
    }
  }
  return attempts
}

/** The document, as markdown. */
export function markdownReport(run) {
  const attempts = attemptsOf(run)
  const baseline = run.check?.working?.value ?? 0
  const tasks = run.check?.tasks ?? []
  const weights = Object.entries(run.check?.weights ?? {})
  const winner = run.winner ?? null
  const kept = attempts.filter(attempt => attempt.best)

  const lines = []
  lines.push(`# Dream: ${run.target?.target ?? 'a target'}`)
  lines.push('')
  lines.push(`Started ${run.target?.startedAt ?? '—'}. Every number below was measured by the setup in this directory.`)
  lines.push('')
  lines.push(`Status **${run.status?.status ?? 'unknown'}** after round ${run.status?.round ?? attempts.length}.`)
  lines.push('')

  lines.push('## What is measured')
  lines.push('')
  lines.push('A candidate is scored by running every task headless with no model in the loop. All tasks must pass; then each measure is summed across tasks, multiplied by its weight, and subtracted from 1.')
  lines.push('')
  lines.push('| task | asked |')
  lines.push('| --- | --- |')
  for (const task of tasks) lines.push(`| \`${task.id}\` | ${task.question} |`)
  lines.push('')
  lines.push(`Weights: ${weights.length ? weights.map(([measure, weight]) => `\`${weight}\` per ${measure}`).join(', ') : 'none'}.`)
  lines.push('')

  if (run.check?.control) {
    lines.push('## The control')
    lines.push('')
    lines.push(`The setup must fail a deliberately broken target, or it cannot tell an improvement from a regression. The break and its effect:`)
    lines.push('')
    lines.push(`- broke \`${run.check.control.why ?? 'the target'}\``)
    lines.push(`- every task still passing would have refused this setup; the control scored ${number(run.check.control.value)} and was refused for: ${run.check.control.reason ?? '—'}`)
    lines.push('')
  }

  lines.push('## The target as it stands')
  lines.push('')
  lines.push(`Value **${number(baseline)}**${run.check?.working?.totals?.measures ? `, measuring ${Object.entries(run.check.working.totals.measures).map(([measure, amount]) => `${number(amount)} ${measure}`).join(', ')}` : ''}.`)
  lines.push('')

  lines.push('## What it cost')
  lines.push('')
  const spent = costOfRun(run)
  lines.push(`Design ${spent.design?.priced ? formatRmb(spent.design.now) : 'none recorded'}, candidates ${spent.candidates.priced ? formatRmb(spent.candidates.now) : 'none recorded'}, total **${spent.total.priced ? formatRmb(spent.total.now) : 'unknown'}** at the hour the calls were made.`)
  lines.push('')
  if (spent.total.priced) {
    lines.push(`Between ${formatRmb(spent.total.offPeak)} and ${formatRmb(spent.total.peak)} depending on the hour: ${PRICING.modelVersion} is charged at half price outside Beijing working hours.`)
    lines.push('')
  }
  lines.push(`Priced by \`tools/dream/pricing.mjs\`: ${PRICING.model} at ¥${PRICING.rates.peak.cacheMiss} cache miss, ¥${PRICING.rates.peak.cacheHit} cache hit and ¥${PRICING.rates.peak.output} output per 1M tokens at peak, read ${PRICING.readAt} from ${PRICING.source}.`)
  lines.push('')

  lines.push('## Attempts')
  lines.push('')
  lines.push('| round | candidate | from | value | measures | tokens | cost | verdict |')
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- |')
  for (const attempt of attempts) {
    const measures = attempt.measures ? Object.entries(attempt.measures).map(([measure, amount]) => `${measure} ${number(amount)}`).join(' ') : '—'
    lines.push(`| ${attempt.round} | \`${attempt.id}\` | ${attempt.parent} | ${number(attempt.value)} | ${measures} | ${attempt.tokens ?? 'none'} | ${formatRmb(attempt.cost.now)} | ${attempt.scored ? (attempt.best ? 'kept' : 'scored, not better') : `refused: ${attempt.reason ?? ''}`} |`)
  }
  if (!attempts.length) lines.push('| — | no candidate has run | — | — | — | — | — |')
  lines.push('')
  lines.push('![score against attempts](graph.svg)')
  lines.push('')
  lines.push('![who descends from whom](tree.svg)')
  lines.push('')

  lines.push('## The winner')
  lines.push('')
  if (winner && winner.id !== 'baseline' && kept.length) {
    lines.push(`\`${winner.id}\` scored **${number(winner.value)}** against the target's ${number(baseline)}, an improvement of ${number(winner.improvement)}.`)
    lines.push('')
    if (winner.patchMissing) {
      lines.push(`No patch was written for it, so it cannot be landed: ${winner.patchMissing}.`)
    } else {
      lines.push(`Its patch is \`${winner.patch ?? 'winner.patch'}\` in this directory. To land it:`)
      lines.push('')
      lines.push('```sh')
      lines.push(`git apply ${winner.patch ?? 'winner.patch'}`)
      lines.push('```')
    }
  } else {
    lines.push('No candidate beat the target as it stands. Everything tried is above.')
  }
  lines.push('')
  return `${lines.join('\n')}\n`
}

/**
 * Write the document and the two pictures into a run's directory.
 *
 * Called after every round, so a run that is still going can be read while it
 * goes rather than only when it stops.
 */
export async function renderReport(runDirectory) {
  const run = await readRun(runDirectory)
  const attempts = attemptsOf(run)
  const baseline = run.check?.working?.value ?? 0

  await fs.writeFile(path.join(runDirectory, 'report.md'), markdownReport(run), 'utf8')
  await fs.writeFile(path.join(runDirectory, 'graph.svg'), svgImprovement({ baseline, points: attempts }), 'utf8')
  await fs.writeFile(path.join(runDirectory, 'tree.svg'), svgLineage({ baseline, nodes: attempts }), 'utf8')

  return {
    report: path.join(runDirectory, 'report.md'),
    graph: path.join(runDirectory, 'graph.svg'),
    tree: path.join(runDirectory, 'tree.svg'),
    attempts: attempts.length
  }
}

// Run directly: rewrite one run's document and pictures from its records. This
// is how a run that finished before a change to this file gets a document that
// matches the change, without rerunning anything.
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const at = process.argv.indexOf('--run')
  const named = at >= 0 ? process.argv[at + 1] : null
  if (!named) {
    process.stderr.write('usage: node tools/dream/report.mjs --run agent-runs/dream-...\n')
    process.exit(2)
  }
  const directory = path.resolve(CHECKOUT, named)
  if (!(await fs.access(directory).then(() => true, () => false))) {
    process.stderr.write(`no run at ${named}\n`)
    process.exit(2)
  }
  const written = await renderReport(directory)
  process.stdout.write(`${written.report}\n${written.graph}\n${written.tree}\n`)
}
