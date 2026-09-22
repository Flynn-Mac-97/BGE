/**
 * What a candidate costs, in the units a setup can count.
 *
 * Every measure here is a number a setup can name and weight. They are
 * primitives rather than a policy: which of them matter, and what each is worth,
 * belongs to the setup for one target, not to this file.
 *
 * Two of them read the harness. The context half of a cost is what the engine
 * hands an agent to read, which `agent.context` counts with no model in the
 * loop. The token half is what a real run spent, which only the harness writes
 * down, as per-step `usage` in the session transcript.
 *
 * The transcript is zstd-compressed JSONL in many frames, and Node's zstd
 * stream stops at the first frame — one decompress call reads 209 characters of
 * a 257 KB file and reports success, which is worse than failing. Frames are
 * located by their magic bytes and decoded one at a time.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'

/** The frame header every zstd frame starts with. */
const FRAME_MAGIC = [0x28, 0xb5, 0x2f, 0xfd]

/** The one file a session holds. Named here so a harness rename fails loudly. */
const TRANSCRIPT = 'session.v3.jsonl.zstd'

/** How long one engine process may take before its task is a failure. */
const DEFAULT_PROCESS_TIMEOUT_MS = 180000

/**
 * Characters in one context packet, as the engine counts them.
 *
 * The engine's own `characters` field is used rather than the length of the
 * envelope, because the envelope's key names are not part of what an agent
 * reads as instructions. A packet that fails to build reports the failure
 * instead of a number, so a candidate cannot win by breaking the packet.
 */
export function packetCharacters(checkout, request, { timeout = 120000 } = {}) {
  const started = Date.now()
  let output
  try {
    output = execFileSync(process.execPath, ['bin/engine.mjs', 'agent.context', JSON.stringify(request)], {
      cwd: checkout,
      encoding: 'utf8',
      timeout,
      maxBuffer: 64 * 1024 * 1024,
      windowsHide: true
    })
  } catch (error) {
    return { error: String(error?.message || error), milliseconds: Date.now() - started }
  }
  let characters = output.length
  try {
    const envelope = JSON.parse(output)
    if (typeof envelope.characters === 'number') characters = envelope.characters
  } catch {
    // A packet that is not JSON is still a cost; the raw length stands.
  }
  return { characters, milliseconds: Date.now() - started }
}

/**
 * One engine process, and the reply it printed.
 *
 * `--headless` is always passed: a measure that needed a dev server would make
 * a score depend on what else is running on the machine.
 */
export function engineProcess(checkout, project, args, { timeout = DEFAULT_PROCESS_TIMEOUT_MS, level } = {}) {
  const started = Date.now()
  const run = spawnSync(
    process.execPath,
    ['bin/engine.mjs', '--headless', '--project', project, ...(level ? ['--level', level] : []), ...args],
    { cwd: checkout, encoding: 'utf8', timeout, maxBuffer: 64 * 1024 * 1024, windowsHide: true }
  )
  const milliseconds = Date.now() - started
  if (run.error) return { reply: null, milliseconds, problem: `failed to start: ${run.error.message}` }
  if (run.status !== 0) {
    const said = String(run.stderr || run.stdout || '').trim().split('\n').slice(0, 2).join(' | ')
    return { reply: null, milliseconds, problem: `exited ${run.status}${said ? ` — ${said}` : ''}` }
  }
  try {
    return { reply: JSON.parse(String(run.stdout).trim()), milliseconds, problem: null }
  } catch (error) {
    return { reply: null, milliseconds, problem: `the reply is not JSON — ${error.message}` }
  }
}

/** Every frame in a session transcript, decoded. */
export function transcriptFrames(buffer) {
  const offsets = []
  for (let at = 0; at + 4 <= buffer.length; at++) {
    if (FRAME_MAGIC.every((byte, index) => buffer[at + index] === byte)) offsets.push(at)
  }
  const frames = []
  for (const at of offsets) {
    try {
      frames.push(zstdDecompressSync(buffer.subarray(at)).toString('utf8'))
    } catch {
      // A frame whose content size is unknown cannot be decoded from a bare offset.
    }
  }
  return frames
}

/** Token totals with nothing in them, so a caller has one shape to add to. */
export function usageTotals() {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, reasoningTokens: 0, totalTokens: 0, steps: 0 }
}

/**
 * Add the usage records in decoded frames to `totals`.
 *
 * A record that merely quotes the word is skipped: tool results carry the
 * engine's own text, and counting a mention as a spend would inflate every run
 * that read about token use.
 */
export function addUsage(frames, totals) {
  for (const frame of frames) {
    for (const line of frame.split('\n')) {
      if (!line.includes('totalTokens')) continue
      let record
      try {
        record = JSON.parse(line)
      } catch {
        continue
      }
      const usage = record?.data?.usage ?? record?.usage
      if (!usage || typeof usage.totalTokens !== 'number') continue
      totals.steps++
      for (const key of ['inputTokens', 'outputTokens', 'cacheReadTokens', 'reasoningTokens', 'totalTokens']) {
        totals[key] += usage[key] ?? 0
      }
    }
  }
  return totals
}

/**
 * Add pi's usage records to `totals`.
 *
 * pi writes plain JSONL and names the same counts differently, so the keys are
 * mapped here and the totals keep one shape for every harness.
 */
export function addPiUsage(text, totals) {
  for (const line of text.split('\n')) {
    if (!line.includes('totalTokens')) continue
    let record
    try {
      record = JSON.parse(line)
    } catch {
      continue
    }
    const usage = record?.message?.usage
    if (!usage || typeof usage.totalTokens !== 'number') continue
    totals.steps++
    totals.inputTokens += usage.input ?? 0
    totals.outputTokens += usage.output ?? 0
    totals.cacheReadTokens += usage.cacheRead ?? 0
    totals.reasoningTokens += usage.reasoning ?? 0
    totals.totalTokens += usage.totalTokens
  }
  return totals
}

/**
 * Tokens a session spent, summed from its per-step usage records.
 *
 * The harness is told apart by what it wrote: dsh keeps one compressed
 * transcript under a fixed name, pi keeps one JSONL file per session.
 */
export function sessionTokens(directory) {
  const dshTranscript = join(directory, TRANSCRIPT)
  if (existsSync(dshTranscript)) {
    return addUsage(transcriptFrames(readFileSync(dshTranscript)), usageTotals())
  }
  let piTranscripts = []
  try {
    piTranscripts = readdirSync(directory).filter(name => name.endsWith('.jsonl'))
  } catch {
    return { error: `no transcript in ${directory}` }
  }
  if (!piTranscripts.length) return { error: `no transcript in ${directory}` }
  const totals = usageTotals()
  for (const name of piTranscripts) {
    addPiUsage(readFileSync(join(directory, name), 'utf8'), totals)
  }
  return totals
}
