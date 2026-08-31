/**
 * Which attached page a bridge call is for.
 *
 * A dev server can have several pages attached at once: the person's editor,
 * and one headless page per lane. Sending a call to all of them and keeping
 * the first reply makes the fastest page the answer, which is not the same as
 * the right one — a hidden tab answered a capture with a blank frame that way.
 * So a call names its client, and a call that cannot name one is refused with
 * the list rather than guessed at. Naming only works while one name means one
 * page, so mergeClient refuses a second page claiming a name already in use.
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

/** The same page, proven by a value only that page holds. */
const samePage = (entry, nonce) => Boolean(nonce) && entry.nonce === nonce

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
 * The second page is refused and the first keeps both the name and its calls.
 * `said.nonce` is the page's own value and survives reload, so it separates one
 * page reconnecting from a different page claiming the same name. A name whose
 * page has gone is free again.
 */
export function mergeClient(clients, socket, client, said) {
  const name = String(said?.id || 'unnamed')
  const nonce = said?.nonce ? String(said.nonce) : ''
  const [rivalSocket, held] =
    [...clients].find(([key, entry]) => key !== socket && entry.id === name) || []
  if (held) {
    if (isLive(held) && !samePage(held, nonce)) return { error: 'name-taken', existing: held }
    // A reconnect announces on a new socket before the old one closes. One page
    // holds one entry, or every call to it is ambiguous.
    clients.delete(rivalSocket)
  }
  const since = clients.get(socket)?.since || held?.since || new Date().toISOString()
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
    return `no editor attached. Open ${where} and leave the tab open.`
  }
  if (error === 'unknown-client') {
    return `no attached client "${wanted}". Attached now:\n  ${named}`
  }
  if (error === 'ambiguous-client') {
    return `more than one client calls itself "${wanted}":\n  ${named}`
  }
  if (error === 'name-taken') {
    return `"${wanted}" is already attached and answering:\n  ${named}\n` +
      `Open this page under another name with ?client=<id>.`
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
