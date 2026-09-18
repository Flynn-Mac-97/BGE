#!/usr/bin/env bash

# Watch the newest Dream run: what each candidate scored, and what the agent
# working right now is doing. The working half is read from the agent's own
# harness transcript, because the run directory gains nothing until a candidate
# finishes.
set -u

run_directory="${1:-}"
interval="${INTERVAL:-3}"
once="${2:-}"

if [[ -z "$run_directory" ]]; then
  run_directory="$(find agent-runs -maxdepth 1 -type d -name 'dream-*' -print | sort | tail -n 1)"
fi

if [[ -z "$run_directory" || ! -d "$run_directory" ]]; then
  printf 'No Dream run found.\n' >&2
  exit 1
fi

while true; do
  clear
  node --input-type=module - "$run_directory" <<'NODE'
import fs from 'node:fs'
import path from 'node:path'
import { costBands, sumCosts } from './tools/dream/pricing.mjs'
import { workingAttempts } from './tools/dream/live.mjs'

const runDirectory = process.argv[2]
const readJson = file => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return null }
}
const relative = path.relative(process.cwd(), runDirectory) || runDirectory
const run = readJson(path.join(runDirectory, 'run.json')) ?? {}
const target = readJson(path.join(runDirectory, 'target.json')) ?? {}
const design = readJson(path.join(runDirectory, 'design.json')) ?? {}
const winner = readJson(path.join(runDirectory, 'winner.json'))
const stopping = fs.existsSync(path.join(runDirectory, 'stop'))

const colour = process.stdout.isTTY
  ? { reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m', green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m', cyan: '\x1b[36m' }
  : { reset: '', dim: '', bold: '', green: '', red: '', yellow: '', cyan: '' }
const paint = (value, tone) => `${colour[tone] ?? ''}${value}${colour.reset}`
const plain = value => String(value).replace(/\x1b\[[0-9;]*m/g, '')
const rule = '─'.repeat(86)
const box = value => {
  const text = String(value)
  return `│ ${text}${' '.repeat(Math.max(0, 84 - plain(text).length))} │`
}

const elapsed = ms => {
  const seconds = Math.max(0, Math.round(ms / 1000))
  const minutes = Math.floor(seconds / 60)
  return minutes ? `${minutes}m ${String(seconds % 60).padStart(2, '0')}s` : `${seconds}s`
}
const bar = (value, max, width = 20) => {
  const filled = max > 0 ? Math.max(0, Math.min(width, Math.round((value / max) * width))) : 0
  return `${'#'.repeat(filled)}${'-'.repeat(width - filled)}`
}

// Every lane a round has already written a record for.
const roundsDirectory = path.join(runDirectory, 'rounds')
const rounds = fs.existsSync(roundsDirectory)
  ? fs.readdirSync(roundsDirectory).filter(name => name.startsWith('r')).sort()
  : []
const lanes = []
const totalCosts = []
if (design.tokens) {
  const cost = costBands(design.tokens)
  totalCosts.push(cost)
  lanes.push({ round: '-', lane: '-', id: 'design', state: run.status === 'designing' ? 'working' : 'done', score: '-', tokens: design.tokens.totalTokens, spent: cost.now, steps: design.tokens.steps })
}
let maxSteps = 0
for (const round of rounds) {
  const directory = path.join(roundsDirectory, round)
  for (const file of fs.readdirSync(directory).filter(name => name.endsWith('.json') && name !== 'round.json').sort()) {
    const record = readJson(path.join(directory, file))
    if (!record) continue
    const cost = record.cost ?? (record.tokens ? costBands(record.tokens) : null)
    if (cost) totalCosts.push(cost)
    if (record.tokens?.steps) maxSteps = Math.max(maxSteps, record.tokens.steps)
    lanes.push({
      round: round.replace(/^r0*/, '') || '0',
      lane: `c${record.attempt ?? '?'}`,
      id: record.id ?? file,
      state: record.verdict ?? 'working',
      score: record.value == null ? '?' : record.value,
      tokens: record.tokens?.totalTokens,
      spent: cost?.now ?? null,
      steps: record.tokens?.steps ?? null
    })
  }
}

// Lanes working now, from each attempt's own transcript.
const working = workingAttempts({ checkout: process.cwd(), runName: path.basename(runDirectory) })

console.log(`╭${rule}╮`)
console.log(box(`DREAM · ${run.status ?? 'unknown'}${stopping ? paint(' · stopping', 'yellow') : ''} · round ${run.round ?? '-'}`))
console.log(box(paint(relative, 'dim')))
console.log(box(`target: ${String(target.target ?? run.target ?? '-').slice(0, 76)}`))

if (working.length) {
  console.log(`├${rule}┤`)
  console.log(box(paint('WORKING NOW', 'bold')))
  for (const attempt of working) {
    const spin = '|/-\\'[Math.floor(Date.now() / 250) % 4]
    const age = attempt.startedAt ? elapsed(Date.now() - attempt.startedAt) : '?'
    const progress = attempt.steps == null
      ? ''
      : maxSteps
        ? `  [${bar(attempt.steps, maxSteps)}] ${attempt.steps}/${maxSteps} steps`
        : `  ${attempt.steps} steps`
    const quiet = attempt.quietSeconds == null
      ? ''
      : attempt.quietSeconds < 60
        ? `  wrote ${attempt.quietSeconds}s ago`
        : paint(`  quiet ${elapsed(attempt.quietSeconds * 1000)}`, 'yellow')
    console.log(box(`${paint(spin, 'cyan')} c${attempt.candidate}  round ${attempt.round}  ${age}${progress}${quiet}`))
    const calls = attempt.calls.slice(-3)
    if (!calls.length) console.log(box(paint('    no tool call yet — reading the task', 'dim')))
    for (const call of calls) console.log(box(paint(`    ${call.tool.padEnd(5)} ${call.detail.slice(0, 76)}`, 'dim')))
    if (attempt.thought) console.log(box(paint(`    … ${attempt.thought.text.replace(/\s+/g, ' ').slice(0, 90)}`, 'dim')))
  }
}

const totals = sumCosts(totalCosts)
console.log(`├${rule}┤`)
const workingNote = working.length ? `  ·  ${working.length} working` : ''
console.log(box(`total  tokens ${totals.totalTokens ?? '?'}  spent ${totals.now == null ? '?' : `¥${totals.now.toFixed(4)}`}  recorded ${lanes.length}${workingNote}`))

console.log(`├${rule}┤`)
console.log(box(paint('ROUND LANE  AGENT                    STATE      SCORE       STEPS  TOKENS      SPENT', 'dim')))
if (!lanes.length) console.log(box('no lane records yet'))
for (const lane of lanes) {
  const tone = lane.state === 'scored' || lane.state === 'done' ? 'green' : lane.state === 'failed' || lane.state === 'refused' ? 'red' : 'yellow'
  const cells = [
    String(lane.round).padEnd(5),
    String(lane.lane).padEnd(5),
    String(lane.id).slice(0, 22).padEnd(24),
    paint(String(lane.state).slice(0, 10).padEnd(10), tone),
    String(lane.score).slice(0, 11).padEnd(11),
    String(lane.steps ?? '?').padEnd(6),
    String(lane.tokens ?? '?').padEnd(11),
    lane.spent == null ? '?' : `¥${lane.spent.toFixed(4)}`
  ]
  console.log(box(cells.join(' ')))
}
console.log(`╰${rule}╯`)
if (winner) {
  console.log(box(paint(`winner  ${winner.id}  value ${winner.value}  patch ${winner.patch ?? 'none'}`, 'green')))
}
NODE

  [[ "$once" == "--once" || "${WATCH_ONCE:-}" == "1" ]] && break
  sleep "$interval"
done
