/**
 * Which attached page a bridge call is for.
 *
 * A dev server can have several pages attached at once: the person's editor,
 * and one headless page per lane. Sending a call to all of them and keeping
 * the first reply makes the fastest page the answer, which is not the same as
 * the right one — a hidden tab answered a capture with a blank frame that way.
 * So a call names its client, and a call that cannot name one is refused with
 * the list rather than guessed at. Naming only works while one name means one
 * page, so mergeClient refuses every second page while the page holding the
 * name is still open.
 */

/** Whether a page's socket is still open. */
export const isLive = entry => entry?.client?.socket?.readyState === 1

/**
 * A client as a caller sees it.
 *
 * The socket and the nonce stay on the server. A caller that could read the
 * nonce could send it back and take the name it belongs to.
 */
export const publicClient = ({ client, nonce, ...rest }) => rest

/**
 * The same page coming back to a name its socket has already given up.
 *
 * It decides the attach time and nothing else. A nonce can be copied, so it
 * never takes a name off a page that is still open.
 */
const samePage = (entry, nonce) => Boolean(nonce) && entry?.nonce === nonce

/**
 * The nonce a page announces as its own.
 *
 * Chrome copies sessionStorage into a tab opened with window.open, so a popup
 * starts out holding the opener's nonce. A page with an opener did not start
 * this session, so the stored value is not its own: mint a fresh one and keep
 * that instead.
 *
 * This runs in the browser. The tab beacon in vite.config.js inlines this
 * function's own source, so one definition serves both sides and a node test
 * proves the code the page runs. Keep it self-contained.
 */
export function ownNonce(storage, { hasOpener, mint }) {
  const stored = storage.getItem('engine:tab-nonce')
  if (stored && !hasOpener) return stored
  const fresh = mint()
  storage.setItem('engine:tab-nonce', fresh)
  return fresh
}

/**
 * The stored entry, built from what the page said. Only the server knows
 * `project` and `serves`, so the caller sets its own — in `said` or on the
 * stored entry — and never leaves the page's values standing.
 */
const clientEntry = (client, said, { name, nonce, since }) => ({
  client,
  id: name,
  nonce,
  url: String(said?.url || ''),
  title: String(said?.title || ''),
  project: String(said?.project || ''),
  serves: String(said?.serves || ''),
  hidden: said?.hidden === true,
  viewport: String(said?.viewport || ''),
  pixelRatio: Number(said?.pixelRatio) || 1,
  headless: said?.headless === true,
  since,
  lastSaid: new Date().toISOString()
})

/**
 * Store what a page announced about itself.
 *
 * `clients` is keyed by socket. Returns `{ ok: true }`, or
 * `{ error: 'name-taken', existing }` and stores nothing.
 *
 * A name is how a caller targets one page, so two pages cannot hold one name.
 * A page that holds the name and is still open keeps it, and the second page is
 * refused. Nothing a second announcement carries can prove it is the first: a
 * nonce is a value, and a value can be copied. The name is free again only when
 * the socket holding it closes, or when that same socket announces again.
 */
export function mergeClient(clients, socket, client, said) {
  const name = String(said?.id || 'unnamed')
  const nonce = said?.nonce ? String(said.nonce) : ''
  const [rivalSocket, held] =
    [...clients].find(([key, entry]) => key !== socket && entry.id === name) || []
  // Liveness is tested first and alone. Any test that can hand a live page's
  // name to a second announcement is a hijack, whatever else it checks.
  if (isLive(held)) return { error: 'name-taken', existing: held }
  // One page holds one entry, or every call to it is ambiguous.
  if (held) clients.delete(rivalSocket)
  const since = clients.get(socket)?.since ||
    (samePage(held, nonce) ? held.since : '') || new Date().toISOString()
  clients.set(socket, clientEntry(client, said, { name, nonce, since }))
  return { ok: true }
}

/**
 * Pick the client for a call.
 *
 * Returns `{ chosen }` or `{ error, live }`. The caller turns the error into a
 * message, because only it knows the server's own address.
 */
export function chooseClient(entries, wanted) {
  const live = entries.filter(isLive)
  if (!live.length) return { error: 'no-client', live }
  if (!wanted) {
    return live.length === 1 ? { chosen: live[0] } : { error: 'many-clients', live }
  }
  const named = live.filter(entry => entry.id === wanted)
  if (!named.length) return { error: 'unknown-client', live }
  // mergeClient refuses a second page claiming a live name, so two live entries
  // under one name mean an entry was stored some other way. Neither is the
  // right answer, so refuse and list them.
  if (named.length > 1) return { error: 'ambiguous-client', live: named }
  return { chosen: named[0] }
}

/** One client on one line: enough to tell it from the others and target it. */
export const describeClient = entry =>
  `${entry.id} (${[
    entry.hidden ? 'hidden' : null,
    entry.viewport || null,
    entry.headless ? 'headless' : null
  ].filter(Boolean).join(', ')}) ${entry.url}`

/**
 * Why a call could not be sent, in words the caller can act on.
 *
 * `where` is the server's own address, so a lane driving its own server is
 * never told to open somebody else's.
 */
export function explainClientError(error, { wanted, live, where, timeout, chosen } = {}) {
  const named = (live || []).map(describeClient).join('\n  ')
  if (error === 'no-client') {
    return `no editor attached. Open ${where} and leave the tab open, `
      + 'or start one through the supervisor: node bin/engine.mjs supervisor.open editor-browser'
  }
  if (error === 'unknown-client') {
    return `no attached client "${wanted}". Attached now:\n  ${named}`
  }
  if (error === 'ambiguous-client') {
    return `more than one client calls itself "${wanted}":\n  ${named}`
  }
  if (error === 'name-taken') {
    return `"${wanted}" is already attached and answering:\n  ${named}\n` +
      `Open this page under another name with ?client=<id>, or stop the browser holding it: `
      + 'node bin/engine.mjs supervisor lists ids, supervisor.stop <id> ends one.'
  }
  if (error === 'many-clients') {
    return `${live.length} clients are attached and none was named, so this call has no one answer. ` +
      `Pick one with --client <id>:\n  ${named}`
  }
  if (error === 'no-reply') {
    return `client ${chosen.id} did not answer in ${timeout} ms. ` + (chosen.hidden
      ? 'It reports itself hidden, and a hidden tab stops drawing and stops answering.'
      : `It is at ${chosen.url}.`)
  }
  return `could not reach a client: ${error}`
}
