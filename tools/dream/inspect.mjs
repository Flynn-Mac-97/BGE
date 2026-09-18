/**
 * A small page for watching one dream run, run by hand.
 *
 * A run is a long sequence of measurements and agent calls, and until it stops
 * the only way to see it was to read JSON files on disk. This serves those files
 * as one page that refreshes itself: what the target is, which round is running,
 * what it has spent, and the measure it froze — so a run can be watched rather
 * than trusted.
 *
 * It is a tool, not part of the engine: it serves the run directory and nothing
 * else, binds to the loopback address, and never writes. Nothing about a run
 * needs it, and stopping it loses nothing.
 *
 * Usage: node tools/dream/inspect.mjs [--run <directory>] [--port 4317] [--open]
 */
import http from 'node:http'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readRun } from './report.mjs'
import { PRICING, costBands, sumCosts } from './pricing.mjs'

const CHECKOUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const RUNS = path.join(CHECKOUT, 'agent-runs')

/** The newest run directory, or the one that was named. */
function chooseRun(named) {
  if (named) {
    const directory = path.resolve(CHECKOUT, named)
    if (!fs.existsSync(directory)) return { error: `no run at ${named}` }
    return { directory }
  }
  const newest = fs.readdirSync(RUNS).filter(name => name.startsWith('dream-')).sort().pop()
  if (!newest) return { error: 'no dream run in agent-runs/' }
  return { directory: path.join(RUNS, newest) }
}

/** Whether the process a run recorded is still working. */
function isLive(pid) {
  if (!pid) return null
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** One file from the run directory, as text, or null. */
function textOf(directory, file) {
  try {
    return fs.readFileSync(path.join(directory, file), 'utf8')
  } catch {
    return null
  }
}

/** Every grid in a run's pool, oldest first, with its cells flattened for reading. */
function readGrids(directory) {
  const sources = []
  const poolDirectory = path.join(directory, 'pool')
  for (const name of fs.existsSync(poolDirectory) ? fs.readdirSync(poolDirectory).sort() : []) {
    if (name.endsWith('.json')) sources.push({ file: path.join(poolDirectory, name), name, live: false })
  }
  // A round writes its grid after every attempt, so a rollout in flight can be
  // watched: the cells that are made appear, and the ones the policy has not
  // reached yet stay visible as gaps.
  const roundsDirectory = path.join(directory, 'rsi')
  for (const name of fs.existsSync(roundsDirectory) ? fs.readdirSync(roundsDirectory).sort() : []) {
    const file = path.join(roundsDirectory, name, 'grid.json')
    if (fs.existsSync(file)) sources.push({ file, name: `${name} (live)`, live: true })
  }

  const grids = []
  for (const source of sources) {
    try {
      const grid = JSON.parse(fs.readFileSync(source.file, 'utf8'))
      const cells = []
      for (let branch = 0; branch < (grid.branchCount ?? 0); branch++) {
        for (let attempt = 0; attempt <= (grid.refineCount ?? 0); attempt++) {
          const id = `${branch}:${attempt}`
          const cell = grid.cells?.[id]
          cells.push({
            id,
            branch,
            attempt,
            made: Boolean(cell),
            score: cell?.outcome?.score ?? null,
            verdict: cell?.outcome ? cell.outcome.verdict : 'not attempted',
            reason: cell?.outcome?.reason ?? null,
            measures: cell?.outcome?.measures ?? null,
            tokens: cell?.outcome?.tokens ?? null,
            best: cell?.outcome?.best === true
          })
        }
      }
      grids.push({ name: source.name, live: source.live, id: grid.id, baseline: grid.baseline?.value ?? null, branchCount: grid.branchCount, refineCount: grid.refineCount, cells })
    } catch { /* a grid still being written */ }
  }
  return grids
}

/** One RSI round's records: what the rollout spent, and what dreaming decided. */
function readRsiRounds(directory) {
  const roundsDirectory = path.join(directory, 'rsi')
  const rounds = []
  for (const name of fs.existsSync(roundsDirectory) ? fs.readdirSync(roundsDirectory).sort() : []) {
    const read = file => {
      try {
        return JSON.parse(fs.readFileSync(path.join(roundsDirectory, name, file), 'utf8'))
      } catch {
        return null
      }
    }
    const rollout = read('rollout.json')
    const dreaming = read('dreaming.json')
    if (!rollout && !dreaming) continue
    rounds.push({ name, rollout, dreaming })
  }
  return rounds
}

/** Every policy version a dreaming phase scored, newest phase last. */
function readPolicyVersions(directory) {
  const replayDirectory = path.join(directory, 'replay')
  const versions = []
  for (const name of fs.existsSync(replayDirectory) ? fs.readdirSync(replayDirectory).sort() : []) {
    if (!name.endsWith('.json')) continue
    try {
      versions.push(JSON.parse(fs.readFileSync(path.join(replayDirectory, name), 'utf8')))
    } catch { /* a version still being scored */ }
  }
  return versions
}

/**
 * The worktrees an attempt is working in, and when each last changed.
 *
 * A rollout spends most of its time inside a worktree, and the run directory
 * gains nothing until the attempt finishes. Without this the page sits still for
 * six minutes at a time and reads as a hung run, when the files are moving the
 * whole way.
 */
function readWorktrees(checkout) {
  const root = path.join(checkout, '.agent-worktrees')
  const worktrees = []
  for (const name of fs.existsSync(root) ? fs.readdirSync(root) : []) {
    const directory = path.join(root, name)
    let newest = 0
    let newestFile = null
    let files = 0

    const walk = (at, depth) => {
      let entries
      try {
        entries = fs.readdirSync(at, { withFileTypes: true })
      } catch {
        return
      }
      for (const entry of entries) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue
        const full = path.join(at, entry.name)
        if (entry.isDirectory()) {
          if (depth < 8) walk(full, depth + 1)
          continue
        }
        try {
          const stat = fs.statSync(full)
          files++
          if (stat.mtimeMs > newest) {
            newest = stat.mtimeMs
            newestFile = path.relative(directory, full).split(path.sep).join('/')
          }
        } catch { /* a file that went away while it was being read */ }
      }
    }
    walk(directory, 0)

    // The name a candidate worktree carries is `dream-<run>-rsi-b<branch>-r<round>c<attempt>`.
    const parsed = /rsi-b(\d+)-r(\d+)c(\d+)$/.exec(name)
    worktrees.push({
      name,
      branch: parsed ? Number(parsed[1]) : null,
      round: parsed ? Number(parsed[2]) : null,
      cell: parsed ? `${parsed[1]}:${Number(parsed[3]) - 1}` : null,
      files,
      newestFile,
      quietSeconds: newest ? Math.round((Date.now() - newest) / 1000) : null
    })
  }
  return worktrees.sort((left, right) => (left.quietSeconds ?? 1e9) - (right.quietSeconds ?? 1e9))
}

/** Everything the page shows, read fresh so a refresh is never stale. */
function snapshot(directory) {
  const read = file => {
    const text = textOf(directory, file)
    if (!text) return null
    try {
      return JSON.parse(text)
    } catch {
      return null
    }
  }

  const status = read('run.json')
  const target = read('target.json')
  const check = read('setup-check.json')
  const design = read('design.json')
  const winner = read('winner.json')
  const setupText = textOf(directory, 'setup.mjs')
  // A run is either the evolutionary loop or the Dream-RSI loop. Both write a
  // status, and the page shows whichever it finds rather than assuming one.
  const rsiStatus = read('rsi.json')
  const rsiSummary = read('rsi-summary.json')
  const loop = rsiStatus ? 'Dream-RSI' : 'evolutionary'
  const liveStatus = rsiStatus ?? status
  const grids = loop === 'Dream-RSI' ? readGrids(directory) : []
  const rsiRounds = loop === 'Dream-RSI' ? readRsiRounds(directory) : []
  const policyVersions = loop === 'Dream-RSI' ? readPolicyVersions(directory) : []

  const rounds = []
  const roundsDirectory = path.join(directory, 'rounds')
  for (const name of fs.existsSync(roundsDirectory) ? fs.readdirSync(roundsDirectory).sort() : []) {
    const at = path.join(roundsDirectory, name)
    for (const file of fs.readdirSync(at).filter(entry => entry.endsWith('.json') && entry !== 'round.json').sort()) {
      try {
        const candidate = JSON.parse(fs.readFileSync(path.join(at, file), 'utf8'))
        // Cost is recomputed from the token record every read, so a run made
        // before pricing existed still shows one, and a price change shows up
        // without rerunning anything.
        candidate.cost = costBands(candidate.tokens ?? null)
        rounds.push(candidate)
      } catch { /* a candidate still being written */ }
    }
  }

  const candidateTokens = rounds.reduce((total, one) => total + (one.tokens?.totalTokens ?? 0), 0)
  const spent = rounds.reduce((total, one) => total + (one.durationMs ?? 0), 0)
  const kept = rounds.filter(one => one.best === true)
  const designCost = design?.tokens ? costBands(design.tokens) : null
  const cost = {
    design: designCost,
    candidates: sumCosts(rounds.map(one => one.cost)),
    total: sumCosts([...(designCost ? [designCost] : []), ...rounds.map(one => one.cost)]),
    note: `${PRICING.modelVersion} · ¥${PRICING.rates.peak.cacheMiss} miss / ¥${PRICING.rates.peak.cacheHit} hit / ¥${PRICING.rates.peak.output} output per 1M at peak, half outside Beijing working hours · read ${PRICING.readAt}`
  }

  return {
    name: path.basename(directory),
    directory,
    loop,
    target: target?.target ?? null,
    files: target?.files ?? [],
    startedAt: target?.startedAt ?? null,
    phase: liveStatus?.status ?? liveStatus?.phase ?? 'unknown',
    round: liveStatus?.round ?? 0,
    pid: liveStatus?.pid ?? null,
    live: isLive(liveStatus?.pid),
    why: liveStatus?.why ?? null,
    plan: liveStatus?.plan ?? null,
    policy: liveStatus?.policy ?? null,
    worktrees: readWorktrees(CHECKOUT),
    rsi: loop === 'Dream-RSI'
      ? {
          phase: rsiStatus?.phase ?? 'unknown',
          round: rsiStatus?.round ?? 0,
          plan: rsiStatus?.plan ?? null,
          policy: rsiStatus?.policy ?? null,
          pool: rsiStatus?.pool ?? rsiSummary?.pool ?? null,
          seeded: rsiSummary?.seeded ?? null,
          grids,
          rounds: rsiRounds,
          versions: policyVersions,
          best: rsiSummary?.best ?? rsiStatus?.best ?? null,
          improvement: rsiSummary?.improvement ?? null
        }
      : null,
    baseline: check?.working ? { value: check.working.value, measures: check.working.totals?.measures ?? {} } : null,
    best: rsiSummary?.best
      ? { id: `${rsiSummary.best.grid} ${rsiSummary.best.cell}`, value: rsiSummary.best.score, measures: rsiSummary.best.measures ?? null }
      : status?.best ?? null,
    winner: winner ? { id: winner.id, value: winner.value, improvement: winner.improvement, patch: winner.patch ?? null } : null,
    setup: check ? {
      name: check.name,
      project: check.project,
      weights: check.weights ?? {},
      tasks: check.tasks ?? [],
      control: check.control ? { reason: check.control.reason ?? null } : null
    } : null,
    setupText,
    design: design ? { status: design.status, tokens: design.tokens?.totalTokens ?? null, durationMs: design.durationMs ?? null, text: design.text ?? '' } : null,
    rounds,
    tokens: { candidates: candidateTokens, design: design?.tokens?.totalTokens ?? 0, total: candidateTokens + (design?.tokens?.totalTokens ?? 0) },
    cost,
    spentCandidateMs: spent,
    kept: kept.length,
    graph: textOf(directory, 'graph.svg'),
    tree: textOf(directory, 'tree.svg'),
    log: textOf(directory, 'loop.log'),
    paths: {
      directory,
      report: path.join(directory, 'report.md'),
      graph: path.join(directory, 'graph.svg'),
      tree: path.join(directory, 'tree.svg'),
      winner: path.join(directory, 'winner.patch')
    }
  }
}

/** The page. One file, no dependency, refreshed by its own timer. */
const PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Dream run</title>
<style>
  :root { color-scheme: dark }
  body { margin: 0; padding: 18px 22px 40px; background: #14161a; color: #dfe3e8;
         font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace }
  h1 { font-size: 15px; margin: 0 0 2px; font-weight: 600 }
  h2 { font-size: 12px; margin: 26px 0 8px; text-transform: uppercase; letter-spacing: .08em; color: #8b949e }
  .sub { color: #8b949e; word-break: break-word }
  .row { display: flex; flex-wrap: wrap; gap: 10px; margin: 14px 0 }
  .card { background: #1b1f24; border: 1px solid #2a2f36; border-radius: 8px; padding: 10px 12px; min-width: 130px }
  .card .k { color: #8b949e; font-size: 11px; text-transform: uppercase; letter-spacing: .06em }
  .card .v { font-size: 17px; margin-top: 3px }
  table { border-collapse: collapse; width: 100% }
  th, td { text-align: left; padding: 5px 8px; border-bottom: 1px solid #23272e; vertical-align: top }
  th { color: #8b949e; font-weight: 500; font-size: 11px; text-transform: uppercase; letter-spacing: .06em }
  td.num { text-align: right; font-variant-numeric: tabular-nums }
  .ok { color: #3fb950 } .bad { color: #f85149 } .warn { color: #d29922 } .dim { color: #8b949e }
  .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px }
  .live { background: #3fb950 } .idle { background: #6e7681 }
  pre { background: #1b1f24; border: 1px solid #2a2f36; border-radius: 8px; padding: 10px; overflow: auto; max-height: 420px; margin: 0 }
  svg { background: #fff; border-radius: 8px; max-width: 100%; height: auto }
  a { color: #58a6ff }
</style></head><body>
<h1 id="target">dream run</h1>
<div class="sub" id="sub"></div>
<div class="row" id="cards"></div>
<div class="sub" id="costNote"></div>
<h2>Setup — what this run froze</h2>
<div id="setup"></div>
<div id="now"></div>
<div id="rsi"></div>
<h2>Attempts</h2>
<div id="attempts"></div>
<h2>Score against attempts</h2>
<div id="graph" class="dim">no round has finished yet</div>
<h2>Lineage</h2>
<div id="tree" class="dim">no candidate has run yet</div>
<h2>Where this lives</h2>
<div id="paths"></div>
<script>
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))
const num = v => (typeof v === 'number' ? (Math.round(v * 1e6) / 1e6).toLocaleString('en-US') : '—')
const rmb = v => (typeof v === 'number' && isFinite(v) ? '¥' + (v >= 0.01 ? v.toFixed(2) : v.toFixed(6)) : '—')
const card = (k, v, cls) => '<div class="card"><div class="k">' + esc(k) + '</div><div class="v ' + (cls||'') + '">' + v + '</div></div>'

async function refresh() {
  let d
  try { d = await (await fetch('/api/run')).json() }
  catch (e) { document.getElementById('sub').textContent = 'the inspector stopped: ' + e.message; return }
  if (d.error) { document.getElementById('sub').textContent = d.error; return }

  document.getElementById('target').textContent = d.target || d.name
  const live = d.live === true
  document.getElementById('sub').innerHTML =
    '<span class="dot ' + (live ? 'live' : 'idle') + '"></span>' + esc(d.phase) +
    ' · round ' + d.round +
    ' · ' + (d.pid ? (live ? 'working, pid ' + d.pid : 'pid ' + d.pid + ' is gone') : 'no pid recorded') +
    ' · started ' + esc(d.startedAt) +
    (d.why ? ' · ' + esc(d.why) : '') + '<br>' + esc(d.directory)

  document.getElementById('cards').innerHTML = [
    card('target as it stands', d.baseline ? num(d.baseline.value) : '—'),
    card('best', d.best ? num(d.best.value) + ' <span class="dim">' + esc(d.best.id) + '</span>' : '—', 'ok'),
    card('improvement', d.winner ? num(d.winner.improvement) : '—'),
    card('cost', rmb(d.cost.total.now), 'warn'),
    card('design cost', rmb(d.cost.design ? d.cost.design.now : null)),
    card('candidate cost', rmb(d.cost.candidates.now)),
    card('tokens spent', num(d.tokens.total)),
    card('attempts', String(d.rounds.length) + (d.kept ? ' <span class="ok">' + d.kept + ' kept</span>' : '')),
    card('candidate time', Math.round(d.spentCandidateMs / 1000) + ' s')
  ].join('')
  document.getElementById('costNote').innerHTML = 'cost in RMB at ' + esc(d.cost.total.band === 'peak' ? 'the peak price' : 'the off-peak price') +
    ' · between ' + rmb(d.cost.total.offPeak) + ' and ' + rmb(d.cost.total.peak) + ' depending on the hour<br>' + esc(d.cost.note)

  const s = d.setup
  const designHtml = d.design && d.design.text
    ? '<details><summary class="dim">what the design agent said — ' + num(d.design.tokens) + ' tokens, ' +
      Math.round((d.design.durationMs || 0) / 1000) + ' s</summary><pre>' + esc(d.design.text) + '</pre></details>'
    : ''
  document.getElementById('setup').innerHTML = (!s
    ? '<div class="dim">' + (d.setupText ? 'written, not yet checked' : 'the design agent has not written a setup yet') + '</div>'
    : '<table><tr><th>task</th><th>what it asks</th></tr>' +
      s.tasks.map(t => '<tr><td>' + esc(t.id) + '</td><td class="dim">' + esc(t.question) + '</td></tr>').join('') +
      '</table>' +
      '<p class="dim">weights: ' + (Object.entries(s.weights).map(([k,v]) => esc(v) + ' per ' + esc(k)).join(', ') || 'none') +
      ' · project ' + esc(s.project) + '</p>' +
      (s.control ? '<p class="dim">control — a broken target must fail: ' + esc(s.control.reason) + '</p>' : '')) + designHtml

  const attemptsTable = !d.rounds.length
    ? '<div class="dim">no candidate has run yet</div>'
    : '<table><tr><th>#</th><th>candidate</th><th>from</th><th class="num">value</th><th>measures</th><th class="num">tokens</th><th class="num">cost</th><th class="num">seconds</th><th>verdict</th></tr>' +
      d.rounds.map((c, i) => '<tr><td class="dim">' + (i + 1) + '</td><td>' + esc(c.id) + (c.best ? ' <span class="ok">kept</span>' : '') + '</td>' +
        '<td class="dim">' + esc(c.parent || 'target') + '</td>' +
        '<td class="num">' + num(c.value) + '</td>' +
        '<td class="dim">' + esc(Object.entries(c.measures || {}).map(([k,v]) => k + ' ' + num(v)).join(' ')) + '</td>' +
        '<td class="num">' + num(c.tokens && c.tokens.totalTokens) + '</td>' +
        '<td class="num warn">' + rmb(c.cost && c.cost.now) + '</td>' +
        '<td class="num">' + Math.round((c.durationMs || 0) / 1000) + '</td>' +
        '<td>' + esc(c.verdict === 'scored' ? 'scored' : (c.reason || c.verdict || '')) + '</td></tr>').join('') +
      '</table>'

  const nowSection = document.getElementById('now')
  nowSection.innerHTML = !d.worktrees || !d.worktrees.length
    ? '<h2>Working now</h2><div class="dim">no attempt is in flight</div>'
    : '<h2>Working now</h2><table><tr><th>cell</th><th>round</th><th>worktree</th><th class="num">files</th><th>last changed</th><th class="num">quiet for</th></tr>'
      + d.worktrees.map(w => '<tr><td>' + esc(w.cell ?? '—') + '</td><td class="num">' + esc(w.round ?? '—') + '</td>'
        + '<td class="dim">' + esc(w.name) + '</td><td class="num">' + esc(w.files) + '</td>'
        + '<td class="dim">' + esc(w.newestFile ?? '—') + '</td>'
        + '<td class="num ' + (w.quietSeconds !== null && w.quietSeconds > 120 ? 'warn' : 'ok') + '">' + esc(w.quietSeconds ?? '—') + ' s</td></tr>').join('')
      + '</table>'

  const rsiSection = document.getElementById('rsi')
  if (!d.rsi) {
    rsiSection.innerHTML = ''
  } else {
    const blocks = []
    const plan = d.rsi.plan
    blocks.push('<h2>The loop — ' + esc(d.rsi.phase) + ' · round ' + esc(d.rsi.round) + '</h2>')
    blocks.push('<p class="sub">pool: ' + esc(d.rsi.pool ? d.rsi.pool.grids + ' grids, ' + d.rsi.pool.cells + ' cells recorded' : 'empty')
      + ' · policy: ' + esc(d.rsi.policy || 'the shipping one')
      + (plan ? ' · plan: ' + esc(plan.branchCount) + ' branches × ' + esc(plan.refineCount) + ' refinements — ' + esc(plan.reason) : '') + '</p>')
    if (d.rsi.seeded && d.rsi.seeded.length) {
      blocks.push('<p class="dim">seeded from: ' + d.rsi.seeded.map(one => esc(one.run) + ' (' + one.attempts + ' attempts)').join(', ') + '</p>')
    }

    // The grids: one table per recorded rollout, cells empty where the policy
    // never went. This is the discovery tree the policy moved over.
    for (const grid of d.rsi.grids) {
      blocks.push('<h2>Grid ' + esc(grid.id || grid.name) + '</h2>')
      blocks.push('<p class="sub">target as it stood ' + num(grid.baseline) + ' · ' + esc(grid.branchCount) + ' branches × ' + esc(grid.refineCount + 1) + ' attempts</p>')
      blocks.push('<table><tr><th>cell</th>' + ['score', 'verdict', 'measures', 'tokens'].map(h => '<th class="num">' + h + '</th>').join('') + '</tr>'
        + grid.cells.map(cell => '<tr><td>' + esc(cell.id) + (cell.best ? ' <span class="ok">kept</span>' : '') + '</td>'
          + '<td class="num ' + (cell.made && cell.score !== null ? 'ok' : '') + '">' + num(cell.score) + '</td>'
          + '<td class="dim">' + esc(cell.made ? cell.verdict : 'not attempted') + '</td>'
          + '<td class="dim">' + esc(Object.entries(cell.measures || {}).map(([k, v]) => k + ' ' + num(v)).join(' ')) + '</td>'
          + '<td class="num">' + num(cell.tokens) + '</td></tr>').join('') + '</table>')
    }

    // The rounds: what exploring cost and what dreaming decided.
    for (const round of d.rsi.rounds) {
      const r = round.rollout
      const dream = round.dreaming
      blocks.push('<h2>Round ' + esc(r ? r.round : round.name) + '</h2>')
      if (r) {
        blocks.push('<p class="sub">policy ' + esc(r.policy && r.policy.name) + ' · probes ' + esc(r.rollout.probes)
          + ' · decision rounds ' + esc(r.rollout.rounds) + ' · attained ' + num(r.rollout.attained)
          + ' · ' + Math.round((r.rollout.durationMs || 0) / 1000) + ' s'
          + (r.rollout.failure ? ' · <span class="bad">' + esc(r.rollout.failure) + '</span>' : '') + '</p>')
      }
      if (dream) {
        blocks.push('<table><tr><th>version</th><th>policy</th><th class="num">reward</th><th class="num">best beta</th><th>flat sweep?</th><th>failures</th></tr>'
          + dream.versions.map(v => '<tr><td>' + esc(v.version) + (dream.winner && dream.winner.version === v.version ? ' <span class="ok">selected</span>' : '') + '</td>'
            + '<td>' + esc(v.policy) + '</td><td class="num">' + num(v.score) + '</td><td class="num">' + num(v.bestBeta) + '</td>'
            + '<td class="dim">' + (v.degenerate ? 'yes — beta changes nothing' : 'no') + '</td>'
            + '<td class="dim">' + esc(v.failure || v.failures || '') + '</td></tr>').join('') + '</table>')
        blocks.push('<p class="sub">' + (dream.improved ? '<span class="ok">improved</span> by ' + num(dream.gain) : 'the policy it started from was already the best') + ' · deployed ' + esc(dream.deployed || '—') + '</p>')
      }
    }

    if (d.rsi.best) {
      blocks.push('<h2>Best attempt so far</h2>')
      blocks.push('<p class="sub">' + esc(d.rsi.best.grid) + ' cell ' + esc(d.rsi.best.cell) + ' scored ' + num(d.rsi.best.score)
        + (typeof d.rsi.improvement === 'number' ? ' — ' + num(d.rsi.improvement) + ' over the target as it stood' : '') + '</p>')
    }
    rsiSection.innerHTML = blocks.join('')
  }

  document.getElementById('attempts').innerHTML = attemptsTable

  const graph = document.getElementById('graph'), tree = document.getElementById('tree')
  if (d.graph) { graph.className = ''; graph.innerHTML = d.graph } 
  if (d.tree) { tree.className = ''; tree.innerHTML = d.tree }

  document.getElementById('paths').innerHTML = '<table>' + Object.entries(d.paths)
    .map(([k, v]) => '<tr><td class="dim">' + esc(k) + '</td><td>' + esc(v) + '</td></tr>').join('') + '</table>'
}

refresh()
setInterval(refresh, 2000)
</script></body></html>
`

const argument = name => {
  const at = process.argv.indexOf(`--${name}`)
  return at >= 0 ? (process.argv[at + 1] && !process.argv[at + 1].startsWith('--') ? process.argv[at + 1] : true) : undefined
}

const chosen = chooseRun(argument('run'))
if (chosen.error) {
  process.stderr.write(`${chosen.error}\n`)
  process.exit(2)
}

const port = Number(argument('port') ?? 4317)
const directory = chosen.directory

const server = http.createServer((request, response) => {
  if (request.url.startsWith('/api/run')) {
    response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
    response.end(JSON.stringify(snapshot(directory)))
    return
  }
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
  response.end(PAGE)
})

server.listen(port, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${port}/`
  process.stdout.write(`watching ${directory}\n${url}\n`)
  if (argument('open')) {
    const opener = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]]
    try {
      execFileSync(opener[0], opener[1], { stdio: 'ignore' })
    } catch { /* a browser that will not open does not stop the page being served */ }
  }
})
