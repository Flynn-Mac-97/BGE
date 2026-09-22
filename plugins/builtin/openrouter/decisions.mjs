/**
 * The OpenRouter Decisions route.
 *
 * A decisions call answers typed questions about supplied state, keyed by
 * question id. It is not a chat completion and does not take messages: one
 * request carries many independent questions, so one round trip classifies a
 * whole list. The route is outside `/api/v1` and this is the only place that
 * spells it.
 *
 * Kept apart from the plugin so the agent-context path can import the route
 * without the plugin's panel and UI.
 */
import { openRouterProxy, proxySend } from './proxy.mjs'

export const DECISIONS_URL = 'https://openrouter.ai/api/alpha/decisions'
/** Pinned, because a floating tag can silently change what a measurement cost. */
export const DECISIONS_MODEL = 'typesafe/jev-1.13'

/** One request body. Ids are keys in the `questions` object and are not sent as instructions. */
export function decisionsBody({ model = DECISIONS_MODEL, state, questions, provider, session }) {
  if (state == null) throw new Error('a decisions call needs state')
  if (!questions || !Object.keys(questions).length) throw new Error('a decisions call needs at least one question')
  return {
    model,
    state,
    questions,
    ...(provider ? { provider } : {}),
    ...(session ? { session_id: session } : {})
  }
}

/** The answers, model and usage of a decisions reply. Unknown answer shapes are dropped. */
export function readDecisions(payload, fallbackModel) {
  const answers = payload && typeof payload.answers === 'object' ? payload.answers : null
  if (!answers) throw new Error('OpenRouter returned no answers')
  return {
    model: payload.model || fallbackModel || null,
    provider: payload.provider || null,
    answers,
    usage: payload.usage || null
  }
}

/**
 * POST one batched decisions request.
 *
 * `send` is injectable for tests. One request and no retry: this is a metered
 * route, and a refused or timed-out suggestion is cheaper than a retry storm.
 * The timeout bounds a hanging proxy.
 */
export async function askDecisions({
  model, state, questions, key, provider, session,
  send, proxy = openRouterProxy(), timeoutMs = 15000
}) {
  if (!key) throw new Error('no OpenRouter key is set')
  const post = send || await proxySend(proxy) || fetch
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await post(DECISIONS_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify(decisionsBody({ model, state, questions, provider, session })),
      signal: controller.signal
    })
    const text = await response.text()
    let payload
    try { payload = JSON.parse(text) } catch { payload = { raw: text } }
    if (!response.ok) {
      throw new Error(`OpenRouter refused: ${payload?.error?.message || payload?.raw || `HTTP ${response.status}`}`)
    }
    return readDecisions(payload, model)
  } finally {
    clearTimeout(timer)
  }
}
