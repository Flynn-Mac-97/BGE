import { spawnSync } from 'node:child_process'
const label = process.argv[2] || 'run'
const result = spawnSync('node', ['agent-runs/crowd/onscreen.mjs', label], { encoding: 'utf8', maxBuffer: 1 << 28 })
const text = (result.stderr || '') + (result.stdout || '')
const start = text.indexOf('MEASURED ')
if (start < 0) { console.log(text.slice(-3000)); process.exit(1) }
const json = JSON.parse(text.slice(start + 'MEASURED '.length))
for (const row of json.rows) {
  if (row.over) { console.log(`${label} ${row.at}s: the run was already over — ${JSON.stringify(row.over)}`); continue }
  console.log(`${label} ${row.at}s: onScreen=${row.onScreen} (${row.lowest}-${row.highest}, +${Math.round((row.withBodies - row.onScreen) * 10) / 10} bodies) alive=${row.alive}/${row.cap} kills=${row.kills} sentBack=${row.sentBack}`)
}
