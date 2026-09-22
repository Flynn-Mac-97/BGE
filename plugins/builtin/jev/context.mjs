/**
 * Jev for engine agent work.
 *
 * Two narrow classifications, both advisory. The guide pass names optional
 * guides a task looks like it needs, so an agent does not read seventy-one
 * withheld guides to find two. The record pass ranks existing ledger records
 * related to a new finding, so the agent does not repeat one that already
 * exists. Neither decides that work is done, and neither removes anything.
 *
 * Node only: it reads files and calls OpenRouter. The packet path imports it,
 * so the browser build never sees it.
 */
import fs from 'node:fs/promises'
import path from 'node:path'

import { DECISIONS_MODEL, askDecisions } from '../openrouter/decisions.mjs'
import { readKey } from '../openrouter/keys.mjs'
import { MODE_FILE, modeText } from './mode.mjs'
import { GUIDE_LABELS, GUIDE_NEGATIVE, RECORD_LABELS, RECORD_NEGATIVE, guideQuestions, rankAnswers, recordQuestions, suggestionLines } from './classify.mjs'

export { MODE_FILE, modeText }

/** The default relevance floor for a suggestion. Set from local labels, not from the vendor. */
export const RELEVANCE_FLOOR = 0.5
/** How many optional guides one pass asks about. The catalogue is under a hundred. */
const DEFAULT_GUIDE_LIMIT = 100
/** How many records a shortlist carries into one pass. */
const DEFAULT_RECORD_LIMIT = 12

/** Whether the stored mode for a project directory switches Jev on. */
export async function storedMode(project) {
  try { return JSON.parse(await fs.readFile(path.join(project, MODE_FILE), 'utf8')).enabled === true }
  catch { return false }
}

/** A per-call override wins; otherwise the project's stored mode decides. */
export async function enabledFor(request, project) {
  if (request?.jev === true) return true
  if (request?.jev === false) return false
  return storedMode(project)
}

/** The key: the environment first, then the project's stored file. Never returned. */
export async function readProjectKey(project) {
  return readKey(file => fs.readFile(path.join(project, file), 'utf8'))
}

/** One frontmatter field of a guide, or null. */
function frontmatterField(text, name) {
  const declared = String(text).match(/^---\s*\n([\s\S]*?)\n---/)?.[1]
  return declared?.match(new RegExp(`^${name}:\\s*(.+)$`, 'm'))?.[1]?.trim() || null
}

/** The description a guide declares, read through the agent reader. */
async function guideDescription(node, read) {
  try { return frontmatterField(await read(node.scope, node.file), 'description') }
  catch { return null }
}

/**
 * The enabled plugin guides a packet did not already select, with descriptions.
 *
 * `always` and file-matched rules are the packet's own business: a guide it
 * already holds needs no suggestion, and a guide the task named by word is
 * already there. This list is only what the packet withheld.
 */
export async function optionalGuideCandidates(pluginNodes, packet, read, limit = DEFAULT_GUIDE_LIMIT) {
  const selected = new Set((packet.nodes || []).map(node => node.id))
  const candidates = []
  for (const node of pluginNodes) {
    if (!node.enabled || selected.has(node.id)) continue
    const description = await guideDescription(node, read)
    if (!description) continue
    candidates.push({ id: node.id, title: node.title || node.id, description, file: node.file })
  }
  return candidates.slice(0, limit)
}

/** Every enabled plugin guide with a description, for a standalone ranking. */
export const allGuideCandidates = (pluginNodes, read, limit = DEFAULT_GUIDE_LIMIT) =>
  optionalGuideCandidates(pluginNodes, { nodes: [] }, read, limit)

/**
 * Rank optional guides for a task in one batched call.
 *
 * Transport faults throw; a caller that must not fail catches and falls back.
 */
export async function rankGuides({ task, files = [], candidates, key, send, proxy, timeoutMs, minimum = RELEVANCE_FLOOR, limit = 5, session = 'engine-jev' }) {
  const questions = guideQuestions(candidates)
  const reply = await askDecisions({ state: { task, files }, questions, key, send, proxy, timeoutMs, session })
  const { ranked, dropped } = rankAnswers(reply.answers, candidates, { labels: GUIDE_LABELS, negative: GUIDE_NEGATIVE, minimum, limit })
  return { model: reply.model, provider: reply.provider, usage: reply.usage, asked: candidates.length, ranked, dropped }
}

/** The compact text of one ledger record, for one question. */
export function recordText(record) {
  return [
    `[${record.kind}] ${record.what}`,
    record.problem ? `problem: ${record.problem}` : null,
    record.where ? `where: ${record.where}` : null,
    record.note ? `note: ${record.note}` : null
  ].filter(Boolean).join(' ')
}

/** Words worth matching on: lowercase, longer than two letters, no punctuation. */
const words = text => String(text || '').toLowerCase().match(/[a-z0-9]{3,}/g) || []

/**
 * The records most likely to be about the same thing as `finding`.
 *
 * A deterministic prefilter, so the network pass sees a short list and never
 * the whole ledger. Any shared word is a candidate, unlike the existing search
 * which needs every word; the ranking itself is Jev's job.
 */
export function recordShortlist(finding, records, limit = DEFAULT_RECORD_LIMIT) {
  const asked = new Set(words(finding))
  return records
    .map(record => {
      const text = recordText(record)
      const overlap = new Set(words(text).filter(word => asked.has(word))).size
      return { record, overlap, text }
    })
    .filter(entry => entry.overlap > 0)
    .sort((a, b) => b.overlap - a.overlap)
    .slice(0, limit)
    .map(({ record, text }) => ({ id: record.id, title: record.id, text, kind: record.kind }))
}

/** Rank existing records related to a new finding in one batched call. */
export async function rankRecords({ finding, candidates, key, send, proxy, timeoutMs, minimum = RELEVANCE_FLOOR, limit = 5, session = 'engine-jev' }) {
  const questions = recordQuestions(candidates)
  const reply = await askDecisions({ state: { finding }, questions, key, send, proxy, timeoutMs, session })
  const { ranked, dropped } = rankAnswers(reply.answers, candidates, { labels: RECORD_LABELS, negative: RECORD_NEGATIVE, minimum, limit })
  return { model: reply.model, provider: reply.provider, usage: reply.usage, asked: candidates.length, ranked, dropped }
}

/**
 * Add guide suggestions to a packet, when switched on.
 *
 * Never throws. A missing key, a dead proxy, a refusal or a malformed reply all
 * return a short reason and leave the packet exactly as it was, so the ordinary
 * packet is the fallback.
 */
export async function addGuideSuggestions({ project, request, packet, pluginNodes, read, ask = {} }) {
  const jev = await enabledFor(request, project)
  if (!jev) return null
  try {
    const { key, where } = await readProjectKey(project)
    if (!key) return { jev: { ok: false, why: 'no OpenRouter key is set' } }
    const candidates = await optionalGuideCandidates(pluginNodes, packet, read)
    if (!candidates.length) return { jev: { ok: true, where, asked: 0, suggested: 0 } }
    const result = await rankGuides({ task: packet.task, files: packet.files, candidates, key, ...ask })
    const lines = suggestionLines(result.ranked)
    return {
      jev: { ok: true, where, model: result.model, asked: result.asked, suggested: result.ranked.length, usage: result.usage },
      suggestions: result.ranked,
      dropped: result.dropped,
      section: lines ? `# Jev suggests\n${lines}\n` : null
    }
  } catch (error) {
    return { jev: { ok: false, why: String(error?.message || error) } }
  }
}
