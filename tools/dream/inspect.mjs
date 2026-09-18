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
    target: target?.target ?? null,
    files: target?.files ?? [],
    startedAt: target?.startedAt ?? null,
    phase: status?.status ?? 'unknown',
    round: status?.round ?? 0,
    pid: status?.pid ?? null,
    live: isLive(status?.pid),
    why: status?.why ?? null,
    baseline: check?.working ? { value: check.working.value, measures: check.working.totals?.measures ?? {} } : null,
    best: status?.best ?? null,
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

  document.getElementById('attempts').innerHTML = !d.rounds.length
    ? '<div class="dim">no candidate has run yet</div>'
    : '<table><tr><th>#</th><th>candidate</th><th>from</th><th class="num">value</th><th>measures</th><th class="num">tokens</th><th class="num">cost</th><th class="num">seconds</th><th>verdict</th></tr>' +
      d.rounds.map((c, i) => '<tr><td class="dim">' + (i + 1) + '</td><td>' + esc(c.id) + (c.best ? ' <span class="ok">kept</span>' : '') + '</td>' +
        '<td class="dim">' + esc(c.parent || 'target') + '</td>' +
        '<td class="num">' + num(c.value) + '</td>' +
        '<td class="dim">' + esc(Object.entries(c.measures || {}).map(([k,v]) => k + ' ' + num(v)).join(' ')) + '</td>' +
        '<td class="num">' + num(c.tokens && c.tokens.totalTokens) + '</td>' +
        '<td class="num warn">' + rmb(c.cost && c.cost.now) + '</td>' +
        '<td class="num">' + Math.round((c.durationMs || 0) / 1000) + '</td>' +
        '<td class="' + (c.verdict === 'scored' ? 'ok' : 'bad') + '">' + esc(c.verdict === 'scored' ? 'scored' : (c.reason || 'refused')) + '</td></tr>').join('') +
      '</table>'

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
