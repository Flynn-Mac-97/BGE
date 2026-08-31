/**
 * Which attached page a bridge call is for.
 *
 * A dev server can have several pages attached at once: the person's editor,
 * and one headless page per lane. Sending a call to all of them and keeping
 * the first reply makes the fastest page the answer, which is not the same as
 * the right one — a hidden tab answered a capture with a blank frame that way.
 * So a call names its client, and a call that cannot name one is refused with
 * the list rather than guessed at.
 */

/** Whether a page's socket is still open. */
export const isLive = entry => entry?.client?.socket?.readyState === 1

/** A client as a caller sees it: everything except the socket. */
export const publicClient = ({ client, ...rest }) => rest

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
  // Two pages can claim one name: `?client=` is whatever the opener asked for.
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
