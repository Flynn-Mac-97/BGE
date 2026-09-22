/**
 * What a Dream-RSI run looks like: its grids, and what replay said about each
 * policy version.
 *
 * The evolutionary loop's pictures describe rounds of candidates against one
 * measure, and a Dream-RSI run has a different shape entirely — branches and
 * attempts, a route a policy took through them, and versions scored by replay.
 * So this draws that shape instead of reusing pictures that would be describing
 * a different loop.
 *
 * Two pictures and one document:
 *
 *   grid.svg    every recorded grid, cell by cell: what each attempt scored, and
 *               the order the policy probed them in
 *   replay.svg  reward against beta for each policy version, and the attainment
 *               curve each version reached against probes spent
 *   report.md   the run in words, with both pictures beside it
 *
 * SVG by hand, no dependency, no randomness: a picture an agent cannot generate
 * without a browser is a picture an agent cannot read.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { PRICING, formatRmb, sumCosts } from './pricing.mjs'

/** SVG text escaped, so a reason containing a bracket cannot break the picture. */
const escape = text => String(text ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** A number for a label: enough digits to tell two attempts apart, no more. */
const number = value => (typeof value === 'number' ? String(Math.round(value * 1e4) / 1e4) : '—')

/** One score as a colour: the best attempt is dark green, the baseline is pale. */
function shadeOf(score, baseline, best) {
  if (typeof score !== 'number') return '#f4f4f4'
  const span = best - baseline
  const position = span > 0 ? Math.min(1, Math.max(0, (score - baseline) / span)) : 1
  const light = 92 - Math.round(position * 62)
  return `hsl(137, ${Math.round(28 + position * 34)}%, ${light}%)`
}

/**
 * Every grid, cell by cell.
 *
 * A cell the policy never probed is drawn as an empty outline: the picture is of
 * a route through a finite environment, and the cells that were left alone are as
 * much of the route as the ones that were taken.
 */
export function svgGrids({ grids = [], width = 900, cellWidth = 62, cellHeight = 44, gap = 6 } = {}) {
  if (!grids.length) return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} 60" width="${width}" height="60"><rect width="${width}" height="60" fill="#fff"/><text x="12" y="34" font-size="13" fill="#666" font-family="ui-monospace, monospace">no grid has been recorded yet</text></svg>\n`

  const headerHeight = 34
  const gridHeight = grid => headerHeight + 22 + (grid.branchCount ?? 0) * (cellHeight + gap)
  const height = 16 + grids.reduce((total, grid) => total + gridHeight(grid) + 14, 0)
  const rows = []
  let y = 16

  for (const grid of grids) {
    const baseline = grid.baseline?.value ?? 0
    const scores = Object.values(grid.cells ?? {}).map(cell => cell.outcome?.score).filter(score => typeof score === 'number')
    const best = scores.length ? Math.max(...scores, baseline) : baseline

    rows.push(`<text x="8" y="${y + 16}" font-size="13" font-weight="600" fill="#222" font-family="ui-monospace, monospace">${escape(grid.id ?? 'grid')}</text>`)
    rows.push(`<text x="8" y="${y + 32}" font-size="11" fill="#777" font-family="ui-monospace, monospace">target ${number(baseline)} · best ${number(best)} · ${escape(grid.branchCount)} branches × ${escape((grid.refineCount ?? 0) + 1)} attempts · a number in a corner is the order it was probed</text>`)

    for (let branch = 0; branch < (grid.branchCount ?? 0); branch++) {
      for (let attempt = 0; attempt <= (grid.refineCount ?? 0); attempt++) {
        const id = `${branch}:${attempt}`
        const cell = grid.cells?.[id]
        const x = 8 + attempt * (cellWidth + gap)
        const top = y + headerHeight + 22 + branch * (cellHeight + gap)
        const score = cell?.outcome?.score
        const fill = cell ? shadeOf(score, baseline, best) : '#ffffff'
        const stroke = cell ? (cell.outcome?.verdict === 'scored' ? '#2f6f45' : '#c0392b') : '#cccccc'
        const dash = cell ? '' : ' stroke-dasharray="4 3"'
        const label = cell ? (typeof score === 'number' ? number(score) : 'refused') : 'not tried'
        const order = typeof cell?.seq === 'number' ? `<text x="${x + cellWidth - 6}" y="${top + 13}" text-anchor="end" font-size="9" fill="#446" font-family="ui-monospace, monospace">${cell.seq}</text>` : ''
        rows.push(`<rect x="${x}" y="${top}" width="${cellWidth}" height="${cellHeight}" rx="5" fill="${fill}" stroke="${stroke}"${dash}/>`)
        // The cell's own name, so the picture and the tables in the document
        // speak about the same thing: `1:0` is attempt 0 of branch 1, either way.
        rows.push(`<text x="${x + 6}" y="${top + 13}" font-size="9" fill="#5a6b60" font-family="ui-monospace, monospace">${escape(id)}</text>`)
        rows.push(`<text x="${x + 6}" y="${top + cellHeight - 8}" font-size="10" fill="#1c2b21" font-family="ui-monospace, monospace">${escape(label)}</text>`)
        rows.push(order)
      }
    }
    y += gridHeight(grid) + 14
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">`
    + `<rect width="${width}" height="${height}" fill="#ffffff"/>`
    + rows.join('')
    + '</svg>\n'
}

/**
 * What replay said: reward against beta for each version, and attainment against
 * probes.
 *
 * A flat line in the top panel is the diagnostic the paper's prompt asks for —
 * that version's beta changes nothing — and the bottom panel is why it can still
 * win: it reaches a higher score in fewer probes.
 */
export function svgSweep({ versions = [], width = 900, top = 240, bottom = 220, baseline = 0 } = {}) {
  const scored = versions.filter(version => !version.failure && Array.isArray(version.perBeta) && version.perBeta.length)
  if (!scored.length) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} 60" width="${width}" height="60"><rect width="${width}" height="60" fill="#fff"/><text x="12" y="34" font-size="13" fill="#666" font-family="ui-monospace, monospace">no policy version has been replayed yet</text></svg>\n`
  }

  const colours = ['#1a7f37', '#1f6feb', '#a4571a', '#8250df', '#b3261e', '#0f766e']
  const left = 64
  const right = 16
  const rewards = scored.flatMap(version => version.perBeta.map(point => point.reward))
  const high = Math.max(...rewards)
  const low = Math.min(...rewards)
  const span = high - low || 1
  const x = beta => left + beta * (width - left - right)
  const y = reward => 30 + (1 - (reward - low) / span) * (top - 60)

  const lines = []
  lines.push(`<text x="8" y="16" font-size="12" font-weight="600" fill="#222" font-family="ui-monospace, monospace">reward against beta — a flat line means that version ignores its knob</text>`)
  for (const fraction of [0, 0.5, 1]) {
    const reward = low + fraction * span
    lines.push(`<line x1="${left}" y1="${y(reward).toFixed(1)}" x2="${width - right}" y2="${y(reward).toFixed(1)}" stroke="#e8e8e8"/>`)
    lines.push(`<text x="${left - 8}" y="${(y(reward) + 4).toFixed(1)}" text-anchor="end" font-size="10" fill="#777" font-family="ui-monospace, monospace">${number(reward)}</text>`)
  }
  scored.forEach((version, index) => {
    const colour = colours[index % colours.length]
    const points = version.perBeta.map(point => `${x(point.beta).toFixed(1)},${y(point.reward).toFixed(1)}`).join(' ')
    lines.push(`<polyline points="${points}" fill="none" stroke="${colour}" stroke-width="2"/>`)
    const last = version.perBeta[version.perBeta.length - 1]
    lines.push(`<text x="${(x(last.beta) - 6).toFixed(1)}" y="${(y(last.reward) + (index % 2 ? 14 : -6)).toFixed(1)}" text-anchor="end" font-size="11" fill="${colour}" font-family="ui-monospace, monospace">`
      + `${escape(version.policy)} v${escape(version.version)}${version.degenerate ? ' (ignores beta)' : ''}</text>`)
  })
  for (const beta of [0, 0.5, 1]) {
    lines.push(`<text x="${x(beta).toFixed(1)}" y="${top - 12}" text-anchor="middle" font-size="10" fill="#777" font-family="ui-monospace, monospace">beta ${beta}</text>`)
  }

  // Attainment against probes, one bold mean curve per version and the grids
  // faintly behind it, so a version that wins on one grid and loses on the rest
  // is visible rather than averaged away.
  const topOfBottom = top + 20
  const curves = scored.filter(version => version.replays?.length)
  const yBottom = value => topOfBottom + 30 + (1 - Math.min(1, Math.max(0, value))) * (bottom - 60)
  lines.push(`<text x="8" y="${topOfBottom - 4}" font-size="12" font-weight="600" fill="#222" font-family="ui-monospace, monospace">attainment against probes — how high, how soon</text>`)
  lines.push(`<line x1="${left}" y1="${yBottom(baseline).toFixed(1)}" x2="${width - right}" y2="${yBottom(baseline).toFixed(1)}" stroke="#c0392b" stroke-dasharray="5 4"/>`)
  lines.push(`<text x="${left - 8}" y="${(yBottom(baseline) + 4).toFixed(1)}" text-anchor="end" font-size="10" fill="#c0392b" font-family="ui-monospace, monospace">${number(baseline)}</text>`)
  scored.forEach((version, index) => {
    const colour = colours[index % colours.length]
    const runs = version.replays ?? []
    if (!runs.length) return
    const most = Math.max(...runs.map(run => (run.trace ?? []).length))
    const step = (width - left - right) / Math.max(1, most)
    for (const run of runs) {
      const points = [`${left},${yBottom(baseline).toFixed(1)}`]
      ;(run.trace ?? []).forEach((round, at) => points.push(`${(left + (at + 1) * step).toFixed(1)},${yBottom(round.attainment).toFixed(1)}`))
      lines.push(`<polyline points="${points.join(' ')}" fill="none" stroke="${colour}" stroke-width="1" opacity="0.28"/>`)
    }
  })

  const height = topOfBottom + bottom
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">`
    + `<rect width="${width}" height="${height}" fill="#ffffff"/>`
    + lines.join('')
    + `</svg>\n`
}

/** The run in words, with both pictures beside it. */
export function markdownRsiReport({ runName, target, rounds = [], grids = [], versions = [], baseline = null, best = null, cost = null, seeded = [] }) {
  const lines = []
  lines.push(`# Dream-RSI: ${target ?? runName}`)
  lines.push('')
  lines.push(`${rounds.length} round${rounds.length === 1 ? '' : 's'}, ${grids.length} grids in the pool, ${versions.length} policy versions replayed.`)
  lines.push('')
  if (baseline) lines.push(`Target as it stood: **${number(baseline.value)}**${baseline.measures ? ` (${Object.entries(baseline.measures).map(([key, value]) => `${number(value)} ${key}`).join(', ')})` : ''}.`)
  if (best) lines.push(`Best attempt: cell \`${best.cell}\` of \`${best.grid}\` at **${number(best.score)}**${best.measures ? ` (${Object.entries(best.measures).map(([key, value]) => `${number(value)} ${key}`).join(', ')})` : ''}.`)
  lines.push('')
  if (cost?.priced) lines.push(`Cost: **${formatRmb(cost.now)}** at the hour the calls were made (${formatRmb(cost.offPeak)}–${formatRmb(cost.peak)} depending on the hour), from ${cost.totalTokens.toLocaleString('en-US')} tokens. Replay itself is free: a policy version is scored by reading records.`)
  else if (grids.length) lines.push('Cost is not recorded for this run: it was made before a round kept its attempts, so there is no per-attempt token record to price. Later runs write `rsi/round-###/attempts.json` and are priced here.')
  lines.push('')
  if (seeded.length) lines.push(`Seeded with grids from: ${seeded.map(one => `\`${one.run}\` (${one.attempts} attempts)`).join(', ')}.`)
  lines.push('')

  lines.push('## The grids')
  lines.push('')
  lines.push('![the grid, cell by cell](grid.svg)')
  lines.push('')
  for (const grid of grids) {
    const cells = Object.values(grid.cells ?? {}).sort((left, right) => left.branch - right.branch || left.attempt - right.attempt)
    lines.push(`**${grid.id ?? 'grid'}** — target ${number(grid.baseline?.value)}`)
    lines.push('')
    lines.push('| cell | order | score | measures | tokens |')
    lines.push('| --- | --- | --- | --- | --- |')
    for (const cell of cells) {
      lines.push(`| \`${cell.branch}:${cell.attempt}\` | ${typeof cell.seq === 'number' ? cell.seq : '—'} | ${number(cell.outcome?.score)} | ${cell.outcome?.measures ? Object.entries(cell.outcome.measures).map(([key, value]) => `${key} ${number(value)}`).join(' ') : '—'} | ${typeof cell.outcome?.tokens === 'number' ? cell.outcome.tokens.toLocaleString('en-US') : '—'} |`)
    }
    lines.push('')
  }

  lines.push('## Rounds')
  lines.push('')
  for (const round of rounds) {
    lines.push(`### Round ${round.round}`)
    lines.push('')
    if (round.plan) lines.push(`Plan: ${round.plan.branchCount} branches × ${round.plan.refineCount} refinements — ${round.plan.reason}.`)
    if (round.policy) lines.push(`Played: \`${round.policy.name}\`${round.policy.beta !== null ? ` at beta ${round.policy.beta}` : ''}.`)
    if (round.rollout) lines.push(`Explored: ${round.rollout.probes} probes in ${round.rollout.rounds} decision rounds, attaining ${number(round.rollout.attained)} in ${Math.round((round.rollout.durationMs ?? 0) / 1000)} s${round.rollout.failure ? ` — ${round.rollout.failure}` : ''}.`)
    if (round.dreaming) {
      lines.push('')
      lines.push('| version | policy | mean reward | best beta | sweep |')
      lines.push('| --- | --- | --- | --- | --- |')
      for (const version of round.dreaming.versions ?? []) {
        lines.push(`| ${version.version}${round.dreaming.winner && round.dreaming.winner.version === version.version ? ' **selected**' : ''} | \`${version.policy}\` | ${number(version.score)} | ${number(version.bestBeta)} | ${version.degenerate ? 'flat — beta changes nothing' : 'responds to beta'} |`)
      }
      lines.push('')
      lines.push(`${round.dreaming.improved ? `Improved by ${number(round.dreaming.gain)}` : 'No version beat the one it started from'}, deployed \`${round.dreaming.deployed ?? '—'}\`.`)
    }
    lines.push('')
  }

  lines.push('## What replay said')
  lines.push('')
  lines.push('![reward against beta, and attainment against probes](replay.svg)')
  lines.push('')
  lines.push(`Priced with \`tools/dream/pricing.mjs\`: ${PRICING.model} at ¥${PRICING.rates.peak.cacheMiss} cache miss, ¥${PRICING.rates.peak.cacheHit} cache hit and ¥${PRICING.rates.peak.output} output per 1M tokens at peak, read ${PRICING.readAt}.`)
  lines.push('')
  return `${lines.join('\n')}\n`
}

/**
 * Write a run's pictures and its document from its own records.
 *
 * Called after each round, so a run still going can be read while it goes, and
 * after the last one so the document ends up describing what actually happened.
 */
export async function renderRsiPictures(runDirectory) {
  const read = async file => JSON.parse(await fs.readFile(path.join(runDirectory, file), 'utf8').catch(() => 'null'))
  const exists = async file => fs.access(file).then(() => true, () => false)

  const poolDirectory = path.join(runDirectory, 'pool')
  const rsiDirectory = path.join(runDirectory, 'rsi')
  const grids = []
  const byId = new Set()
  for (const name of (await fs.readdir(poolDirectory).catch(() => [])).sort()) {
    if (!name.endsWith('.json')) continue
    const grid = JSON.parse(await fs.readFile(path.join(poolDirectory, name), 'utf8'))
    grids.push(grid)
    byId.add(grid.id)
  }
  // A round in flight has a grid that has not joined the pool yet, and that is the
  // one worth watching, so it is appended rather than waited for. Once it joins,
  // the pool copy is the one drawn — the same grid under one name, not two.
  for (const name of (await fs.readdir(rsiDirectory).catch(() => [])).sort()) {
    const file = path.join(rsiDirectory, name, 'grid.json')
    if (!(await exists(file))) continue
    const grid = JSON.parse(await fs.readFile(file, 'utf8'))
    if (!byId.has(grid.id)) grids.push(grid)
  }

  const versions = []
  const replayDirectory = path.join(runDirectory, 'replay')
  for (const name of (await fs.readdir(replayDirectory).catch(() => [])).sort()) {
    if (name.endsWith('.json')) versions.push(JSON.parse(await fs.readFile(path.join(replayDirectory, name), 'utf8')))
  }

  // What each attempt cost, from the per-round attempts records rather than from
  // the summary: the summary describes rounds, the attempts record carries the
  // token breakdown and the money.
  const attemptCosts = []
  for (const name of (await fs.readdir(rsiDirectory).catch(() => [])).sort()) {
    const file = path.join(rsiDirectory, name, 'attempts.json')
    if (await exists(file)) {
      for (const attempt of JSON.parse(await fs.readFile(file, 'utf8'))) {
        if (attempt.cost) attemptCosts.push(attempt.cost)
      }
    }
    // The offline half: what the phase's revising agents spent, recorded with
    // the phase's dreaming result.
    const dreaming = JSON.parse(await fs.readFile(path.join(rsiDirectory, name, 'dreaming.json'), 'utf8').catch(() => 'null'))
    for (const cost of dreaming?.revisionCosts ?? []) if (cost?.priced) attemptCosts.push(cost)
  }

  const target = await read('target.json')
  const check = await read('setup-check.json')
  const summary = await read('rsi-summary.json')
  const status = await read('rsi.json')
  const rounds = summary?.rounds ?? []

  const baseline = check?.working ? { value: check.working.value, measures: check.working.totals?.measures ?? null } : null
  const scoredCells = grids.flatMap(grid => Object.values(grid.cells ?? {})
    .filter(cell => typeof cell.outcome?.score === 'number')
    .map(cell => ({ grid: grid.id, cell: `${cell.branch}:${cell.attempt}`, score: cell.outcome.score, measures: cell.outcome.measures ?? null })))
  const best = scoredCells.length ? scoredCells.reduce((winner, one) => (one.score > winner.score ? one : winner)) : null
  const cost = sumCosts(attemptCosts)

  const gridPicture = svgGrids({ grids })
  const sweepPicture = svgSweep({ versions, baseline: baseline?.value ?? 0 })
  const document = markdownRsiReport({
    runName: path.basename(runDirectory),
    target: target?.target ?? status?.target ?? null,
    rounds,
    grids,
    versions,
    baseline,
    best,
    cost,
    seeded: summary?.seeded ?? []
  })

  await fs.writeFile(path.join(rsiDirectory, 'grid.svg'), gridPicture, 'utf8')
  await fs.writeFile(path.join(rsiDirectory, 'replay.svg'), sweepPicture, 'utf8')
  await fs.writeFile(path.join(rsiDirectory, 'report.md'), document, 'utf8')

  return {
    grid: path.join(rsiDirectory, 'grid.svg'),
    replay: path.join(rsiDirectory, 'replay.svg'),
    document: path.join(rsiDirectory, 'report.md'),
    grids: grids.length,
    versions: versions.length,
    attempts: attemptCosts.length,
    cost
  }
}
