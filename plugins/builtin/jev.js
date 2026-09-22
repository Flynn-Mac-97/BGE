/**
 * Jev — opt-in semantic triage for engine agent work.
 *
 * Jev classifies rather than generates: given supplied candidates it picks,
 * scores or labels them. Here it ranks the optional guides a task looks like it
 * needs, and the existing ledger records related to a new finding. Both are
 * advisory; instructions, file matches, claims and correctness stay in code.
 *
 * Off by default. The switch is per project, and a ranked pass runs from node
 * only, because the OpenRouter proxy is a request-scoped node dispatcher.
 */
import { DECISIONS_MODEL } from './openrouter/decisions.mjs'
import { readKey } from './openrouter/keys.mjs'
import { openRouterProxy } from './openrouter/proxy.mjs'
import { MODE_FILE, modeFrom, modeText } from './jev/mode.mjs'

/** The node-only half. Left out of the browser bundle: it reads files and the proxy. */
const nodeHalf = async () => import(/* @vite-ignore */ './jev/context.mjs')

/** Whether the project switched Jev on. */
async function modeEnabled(context) {
  try { return modeFrom(await context.files.read(MODE_FILE)) } catch { return false }
}

/** What Jev is set to, and whether a key and a proxy are present. Never the key. */
async function status(context) {
  const { key, where } = await readKey(file => context.files.read(file))
  return {
    enabled: await modeEnabled(context),
    model: DECISIONS_MODEL,
    proxy: Boolean(openRouterProxy()),
    key: { found: key !== null, where, last4: key ? key.slice(-4) : null }
  }
}

/** Turn Jev on or off for this project. No argument reads the switch. */
async function setMode(context, options = {}) {
  if (typeof options.on === 'boolean') await context.files.write(MODE_FILE, modeText(options.on))
  return status(context)
}

/** One ranked pass. Throws on a transport fault; a caller decides the fallback. */
async function rank(context, kind, options) {
  const { rankGuides, rankRecords } = await nodeHalf()
  const { key } = await readKey(file => context.files.read(file))
  if (!key) throw new Error('no OpenRouter key is set')
  const passing = { key, minimum: options.minimum, limit: options.limit }
  return kind === 'guides'
    ? rankGuides({ task: options.task, files: options.files || [], candidates: options.candidates, ...passing })
    : rankRecords({ finding: options.finding, candidates: options.candidates, ...passing })
}

export default {
  name: 'Jev',
  category: 'agents',
  skillCategory: 'harnesses',

  onLoad(context) {
    context.jev = {
      status: () => status(context),
      mode: options => setMode(context, options),
      rankGuides: options => rank(context, 'guides', options || {}),
      rankRecords: options => rank(context, 'records', options || {})
    }
  },

  commands: [
    { id: 'jev.status', label: 'Jev status', run: context => status(context) },
    { id: 'jev.mode', label: 'Turn Jev on or off', run: (context, value) => setMode(context, value || {}) },
    { id: 'jev.rankGuides', label: 'Rank guides for a task', run: (context, value) => rank(context, 'guides', value || {}) },
    { id: 'jev.rankRecords', label: 'Rank related records', run: (context, value) => rank(context, 'records', value || {}) }
  ]
}
