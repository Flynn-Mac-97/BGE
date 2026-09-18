/**
 * What an attempt is doing right now, from its own transcript.
 *
 * The run directory gains nothing until an attempt finishes, so a working agent
 * is visible only in the harness transcript under its worktree's session
 * directory. The transcript is zstd JSONL in many frames, and it grows while it
 * is read, so callers read a tail rather than the whole file.
 *
 * The terminal watcher and the inspection page both read this, so the two
 * cannot disagree about what the agent is doing.
 */
import fs from 'node:fs'
import path from 'node:path'
import { transcriptFrames } from './measures.mjs'

/** How much of a transcript the tail readers look at. */
const TAIL_BYTES = 2_000_000

/** Where the harness keeps one session directory per working directory. */
export function sessionRoot() {
  const home = process.env.DSH_HOME || path.join(process.env.USERPROFILE ?? process.env.HOME ?? '.', '.dsh')
  return path.join(home, 'sessions')
}

/** One stat, or null when the file is gone. */
function statOf(target) {
  try { return fs.statSync(target) } catch { return null }
}

/**
 * The session files whose directory name contains `name`, newest first.
 *
 * The harness slug is a lossy encoding of the working directory, so a session
 * is found by the worktree's own name rather than by rebuilding the encoding.
 */
export function sessionsFor(name) {
  const root = sessionRoot()
  if (!fs.existsSync(root) || !name) return []
  const found = []
  for (const slug of fs.readdirSync(root)) {
    if (!slug.includes(name)) continue
    const directory = path.join(root, slug)
    let sessions = []
    try { sessions = fs.readdirSync(directory) } catch { continue }
    for (const session of sessions) {
      const at = path.join(directory, session)
      const file = path.join(at, 'session.v3.jsonl.zstd')
      const stat = statOf(file)
      if (!stat) continue
      found.push({ slug, session, file, mtime: stat.mtimeMs, startedAt: statOf(at)?.birthtimeMs ?? null })
    }
  }
  return found.sort((left, right) => right.mtime - left.mtime)
}

/** The last `bytes` of a transcript, decoded. */
export function tailFrames(file, bytes = TAIL_BYTES) {
  if (!statOf(file)) return []
  try {
    const buffer = fs.readFileSync(file)
    return transcriptFrames(buffer.subarray(Math.max(0, buffer.length - bytes)))
  } catch {
    return []
  }
}

/** One tool call, as much of it as a person needs to see what is happening. */
export function describeCall(record) {
  const data = record.data ?? {}
  let detail = ''
  try {
    const args = JSON.parse(data.arguments ?? '{}')
    detail = args.command ?? args.file_path ?? args.path ?? args.pattern ?? args.query ?? args.subject
      ?? Object.keys(args).slice(0, 3).map(key => `${key}=${String(args[key]).slice(0, 40)}`).join(' ')
  } catch {
    detail = String(data.arguments ?? '').slice(0, 120)
  }
  return {
    seq: record.seq ?? null,
    at: record.time ? new Date(record.time).toISOString().slice(11, 19) : null,
    tool: String(data.name ?? '?'),
    detail: String(detail).split('\n')[0].slice(0, 160)
  }
}

/**
 * Steps an attempt has finished, counted over the whole transcript.
 *
 * The tail undercounts a long session, and a progress bar built on it would
 * fall backwards, so the whole file is read and cached until it grows.
 */
const stepCache = new Map()
export function stepsSoFar(file) {
  const stat = statOf(file)
  if (!stat) return null
  const key = String(stat.size)
  const cached = stepCache.get(file)
  if (cached?.key === key) return cached.steps
  let steps = 0
  for (const frame of transcriptFrames(fs.readFileSync(file))) {
    for (const line of frame.split('\n')) if (line.includes('"step/end"')) steps++
  }
  stepCache.set(file, { key, steps })
  return steps
}

/**
 * What one attempt is doing right now.
 *
 * The last tool calls and the newest reasoning line, which is the only place the
 * work is visible while it happens: the run directory gains nothing until the
 * attempt finishes.
 */
export function liveCalls({ name, since = 0, limit = 12 } = {}) {
  const sessions = sessionsFor(name).filter(session => session.mtime >= since)
  if (!sessions.length) {
    return { session: null, file: null, startedAt: null, steps: null, calls: [], callsSeen: 0, thought: null, quietSeconds: null }
  }

  const newest = sessions[0]
  const calls = []
  let thought = null
  for (const frame of tailFrames(newest.file)) {
    for (const line of frame.split('\n')) {
      if (!line.includes('tool/call') && !line.includes('assistant/message')) continue
      try {
        const record = JSON.parse(line)
        if (record.type === 'tool/call') calls.push(describeCall(record))
        if (record.type === 'assistant/message') {
          const content = record.data?.message?.content ?? []
          const said = content.filter(part => part.type === 'reasoning' || part.type === 'text').map(part => part.text).join(' ')
          if (said.trim()) thought = { at: record.time ? new Date(record.time).toISOString().slice(11, 19) : null, text: said.trim().slice(0, 400) }
        }
      } catch { /* a line cut by the tail window */ }
    }
  }

  return {
    session: newest.session,
    file: newest.file,
    startedAt: newest.startedAt,
    steps: stepsSoFar(newest.file),
    calls: calls.slice(-limit),
    callsSeen: calls.length,
    thought,
    quietSeconds: Math.round((Date.now() - newest.mtime) / 1000)
  }
}

/**
 * The attempts a run has working now.
 *
 * A candidate's worktree is removed once its record is written, so a worktree
 * that still exists is one with work in flight.
 */
export function workingAttempts({ checkout, runName, limit = 12 } = {}) {
  const root = path.join(checkout, '.agent-worktrees')
  if (!fs.existsSync(root) || !runName) return []
  const found = []
  for (const name of fs.readdirSync(root)) {
    if (!name.startsWith(`${runName}-`)) continue
    const parsed = /-r(\d+)c(\d+)$/.exec(name)
    if (!parsed) continue
    found.push({ name, round: Number(parsed[1]), candidate: Number(parsed[2]), ...liveCalls({ name, limit }) })
  }
  return found.sort((left, right) => left.round - right.round || left.candidate - right.candidate)
}
