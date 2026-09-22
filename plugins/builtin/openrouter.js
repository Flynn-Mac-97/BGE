/** OpenRouter — one door to any model OpenRouter serves, for agents and the editor. */
import { KEY_FILE, readKey as readStoredKey } from './openrouter/keys.mjs'
import { DECISIONS_MODEL, askDecisions as postDecisions } from './openrouter/decisions.mjs'
import { openRouterProxy, proxySend } from './openrouter/proxy.mjs'

const HOST = 'https://openrouter.ai/api/v1'

const state = { open: false, models: [], query: '', model: '', prompt: '', key: '', status: null, answer: null, error: null, busy: false }

/**
 * The key, and where it came from.
 *
 * The environment wins, so an agent or a CI run is given a key without writing
 * one down. The stored file is read second; `.engine/` is ignored by git, so a
 * key kept there is never committed.
 */
async function readKey(context) {
  return readStoredKey(path => context.files.read(path))
}

/** The proxy URL for one call: the caller's, or the configured `OPENROUTER_PROXY_URL`. */
const proxyFor = proxy => proxy === undefined ? openRouterProxy() : proxy

/** What a caller may know about the key: that there is one, and its last four. */
async function keyStatus(context) {
  const { key, where } = await readKey(context)
  return { found: key !== null, where, last4: key ? key.slice(-4) : null }
}

/** Store the key beside the project. Returns the status, never the key. */
async function writeKey(context, key) {
  const value = String(key || '').trim()
  if (!value.startsWith('sk-or-')) {
    throw new Error('an OpenRouter key starts with "sk-or-"; copy one from https://openrouter.ai/keys')
  }
  await context.files.write(KEY_FILE, JSON.stringify({ key: value }, null, 2) + '\n')
  return keyStatus(context)
}

/** Forget the stored key. An environment variable is the caller's own to unset. */
async function clearKey(context) {
  await context.files.write(KEY_FILE, JSON.stringify({ key: null }, null, 2) + '\n')
  return keyStatus(context)
}

/** One request to OpenRouter, through the proxy when one is configured. A refusal carries what OpenRouter said. */
async function request(url, { method = 'GET', body, key, send = fetch, proxy } = {}) {
  const headers = { 'content-type': 'application/json' }
  if (key) headers.authorization = `Bearer ${key}`
  const post = send || await proxySend(proxyFor(proxy)) || fetch
  const response = await post(url.startsWith('http') ? url : `${HOST}${url}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body)
  })
  const text = await response.text()
  let value
  try { value = JSON.parse(text) } catch { value = { raw: text } }
  if (!response.ok) throw new Error(`OpenRouter refused: ${value?.error?.message || value?.raw || `HTTP ${response.status}`}`)
  return value
}

/** OpenRouter prices per token; a price per million reads at human scale. */
const perMillion = perToken => perToken === undefined || perToken === null
  ? null
  : Math.round(Number(perToken) * 1_000_000 * 1000) / 1000

/**
 * Every model OpenRouter serves, narrowed by `query`.
 *
 * The list needs no key, so a person can see what is on offer before signing up.
 */
async function listModels(context, { query = '', limit = 50, send } = {}) {
  const answer = await request('/models', { send })
  const wanted = String(query).trim().toLowerCase()
  const all = answer.data || []
  const models = all
    .filter(model => !wanted || `${model.id} ${model.name || ''}`.toLowerCase().includes(wanted))
    .slice(0, limit)
    .map(model => ({
      id: model.id,
      name: model.name || model.id,
      context: model.context_length ?? null,
      promptCostPerMillion: perMillion(model.pricing?.prompt),
      answerCostPerMillion: perMillion(model.pricing?.completion)
    }))
  return { models, listed: all.length, matched: models.length }
}

/** A schema reply that is not JSON is the model's failure, not a crash here. */
const parseOrNull = text => { try { return JSON.parse(text) } catch { return null } }

/**
 * Ask one model one question.
 *
 * `schema` makes the reply JSON of that shape, which is what a typed decision
 * needs — a chosen option and a confidence, not a paragraph.
 */
async function askModel(context, { model, prompt, system, schema, temperature, maxTokens, send } = {}) {
  if (!model) throw new Error('name a model; list them with `node bin/engine.mjs openrouter.models`')
  if (!prompt) throw new Error('a prompt is required')
  const { key } = await readKey(context)
  if (!key) throw new Error('no OpenRouter key is set; set one in the OPENROUTER panel or with `openrouter.key`')

  const messages = []
  if (system) messages.push({ role: 'system', content: String(system) })
  messages.push({ role: 'user', content: String(prompt) })

  const body = { model, messages }
  if (temperature !== undefined) body.temperature = Number(temperature)
  if (maxTokens !== undefined) body.max_tokens = Number(maxTokens)
  if (schema) body.response_format = { type: 'json_schema', json_schema: { name: 'answer', strict: true, schema } }

  const answer = await request('/chat/completions', { method: 'POST', body, key, send })
  const text = answer.choices?.[0]?.message?.content ?? ''
  return {
    model: answer.model || model,
    text,
    value: schema ? parseOrNull(text) : null,
    finish: answer.choices?.[0]?.finish_reason ?? null,
    usage: answer.usage ?? null
  }
}

/** Prove the key works, by asking OpenRouter what it is worth. */
async function checkKey(context, { send } = {}) {
  const { key, where } = await readKey(context)
  if (!key) return { ok: false, why: 'no key is set' }
  const answer = await request('/key', { key, send })
  return { ok: true, where, label: answer.data?.label ?? null, usage: answer.data?.usage ?? null, limit: answer.data?.limit ?? null }
}

/**
 * One batched decisions request: many typed questions about one state.
 *
 * This is OpenRouter's Decisions route, not chat completions. Answers come
 * back keyed by the question id, with the served model and the usage.
 */
async function decisions(context, { model = DECISIONS_MODEL, state, questions, provider, session, send, proxy, timeoutMs } = {}) {
  const { key } = await readKey(context)
  if (!key) throw new Error('no OpenRouter key is set; set one in the OPENROUTER panel or with `openrouter.key`')
  return postDecisions({ model, state, questions, key, provider, session, send, proxy: proxyFor(proxy), timeoutMs })
}

/** Run a panel action, keeping its refusal on screen instead of throwing it away. */
async function act(context, work) {
  state.busy = true
  state.error = null
  context.redraw()
  try { await work() } catch (error) { state.error = String(error?.message || error) }
  state.busy = false
  context.redraw()
}

export default {
  name: 'OpenRouter',
  category: 'agents',
  skillCategory: 'harnesses',

  onLoad(context) {
    context.openrouter = {
      models: options => listModels(context, options),
      ask: options => askModel(context, options),
      decisions: options => decisions(context, options),
      status: () => keyStatus(context),
      check: options => checkKey(context, options)
    }
  },

  menus: [{
    id: 'openrouter.browse', label: 'OPENROUTER', title: 'Reach any model OpenRouter serves', on: () => state.open,
    run: async context => {
      state.open = !state.open
      if (state.open) await act(context, async () => { state.status = await keyStatus(context) })
      context.redraw()
    }
  }],

  panels: [{
    id: 'openrouter', title: 'OpenRouter', dock: 'centre', order: 40, when: () => state.open,
    actions: [
      { label: 'Models', run: context => act(context, async () => { state.models = (await listModels(context, { query: state.query })).models }) },
      { label: 'Close ×', run: context => { state.open = false; context.redraw() } }
    ],
    render(ui, context) {
      const status = state.status
      return ui.stack([
        ui.section('Key', [
          ui.text(status?.found
            ? `a key is set in ${status.where}, ending ${status.last4}`
            : 'no key is set; paste one below', { dim: true }),
          ui.field({ k: 'sk-or-…', v: state.key, onChange: value => { state.key = value } }),
          ui.row([
            ui.button('Save key', () => act(context, async () => {
              state.status = await writeKey(context, state.key)
              state.key = ''
            }), { primary: true }),
            ui.button('Check', () => act(context, async () => { state.answer = await checkKey(context) })),
            ui.button('Forget', () => act(context, async () => { state.status = await clearKey(context) }))
          ]),
          ui.text('Kept in .engine/, which git ignores. OPENROUTER_API_KEY wins when it is set.', { dim: true })
        ]),

        ui.section(`Models · ${state.models.length}`, [
          ui.row([
            ui.field({ k: 'search', v: state.query, onChange: value => { state.query = value } }),
            ui.button('List', () => act(context, async () => { state.models = (await listModels(context, { query: state.query })).models }))
          ]),
          ui.list({
            items: state.models, key: model => model.id,
            row: model => [
              ui.glyph(model.id === state.model ? '✓' : '·'),
              ui.label(model.id),
              ui.spacer(),
              ui.meta(model.promptCostPerMillion === null ? 'price unknown' : `$${model.promptCostPerMillion}/M in · $${model.answerCostPerMillion}/M out`)
            ],
            onPick: model => { state.model = model.id; context.redraw() },
            emptyText: 'press List'
          })
        ]),

        ui.section('Ask', [
          ui.field({ k: 'model', v: state.model, onChange: value => { state.model = value } }),
          ui.field({ k: 'prompt', v: state.prompt, onChange: value => { state.prompt = value } }),
          ui.button('Send', () => act(context, async () => {
            state.answer = await askModel(context, { model: state.model, prompt: state.prompt })
          }), { primary: true }),
          state.busy ? ui.text('asking…', { dim: true }) : null,
          state.error ? ui.text(state.error) : null,
          state.answer ? ui.text(JSON.stringify(state.answer, null, 2)) : null
        ])
      ])
    }
  }],

  commands: [
    { id: 'openrouter.models', label: 'List models', run: (context, value) => listModels(context, value || {}) },
    { id: 'openrouter.ask', label: 'Ask a model', run: (context, value) => askModel(context, value || {}) },
    { id: 'openrouter.decisions', label: 'Ask typed decisions', run: (context, value) => decisions(context, value || {}) },
    { id: 'openrouter.key', label: 'Set or read the key', run: (context, value) => {
      if (value?.clear) return clearKey(context)
      if (value?.key) return writeKey(context, value.key)
      return keyStatus(context)
    } },
    { id: 'openrouter.check', label: 'Prove the key works', run: (context, value) => checkKey(context, value || {}) }
  ]
}
