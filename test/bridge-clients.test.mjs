import test from 'node:test'
import assert from 'node:assert/strict'

import {
  chooseClient, explainClientError, publicClient, describeClient, mergeClient, ownNonce
} from '../engine/bridge-clients.mjs'

/** A page's websocket, as the server holds it. `readyState` 1 is open. */
const openSocket = () => ({ readyState: 1 })

/** A socket the page behind it has gone from. */
const closedSocket = () => ({ readyState: 3 })

/**
 * Announce a page to the server, the way the tab beacon does.
 *
 * Returns the socket so a test can close it or announce on it again, and the
 * outcome mergeClient gave. `serves` and `project` come from the caller, not
 * the page, which is what the server does.
 */
function announce(clients, { id, nonce, socket = openSocket(), ...said }) {
  const client = { socket, send() {} }
  const outcome = mergeClient(clients, socket, client, {
    id,
    nonce,
    url: `http://localhost:5180/?client=${id}`,
    viewport: '540x960',
    ...said,
    project: 'kitten-survivors',
    serves: 'Z:/checkout'
  })
  return { socket, client, outcome }
}

/** The entry a call to this name would reach, or undefined if none would. */
const reaches = (clients, wanted) => chooseClient([...clients.values()], wanted).chosen

/**
 * Backdate an entry's attach time.
 *
 * `since` is an ISO string to the millisecond, so two announcements in one
 * millisecond carry the same one and a lost `since` would read as a kept one.
 */
const attachedLongAgo = (clients, socket) => {
  const when = '2000-01-01T00:00:00.000Z'
  clients.get(socket).since = when
  return when
}

// --- one name, one page -----------------------------------------------------

test('a free name is taken by the page that asks for it', () => {
  const clients = new Map()
  const alpha = announce(clients, { id: 'alpha', nonce: 'page-1' })
  assert.deepEqual(alpha.outcome, { ok: true })
  assert.equal(clients.size, 1)
  assert.equal(reaches(clients, 'alpha').client, alpha.client)
})

test('a page announcing again keeps one entry and its attach time', () => {
  const clients = new Map()
  const alpha = announce(clients, { id: 'alpha', nonce: 'page-1' })
  const first = attachedLongAgo(clients, alpha.socket)

  // The beacon announces again on resize and on visibility change.
  announce(clients, { id: 'alpha', nonce: 'page-1', socket: alpha.socket, hidden: true })
  assert.equal(clients.size, 1)
  assert.equal(clients.get(alpha.socket).hidden, true, 'the newest facts win')
  assert.equal(clients.get(alpha.socket).since, first, 'the page did not just attach')
})

test('a reload keeps the name: old socket gone, same nonce, one entry', () => {
  const clients = new Map()
  const before = announce(clients, { id: 'alpha', nonce: 'page-1' })
  const first = attachedLongAgo(clients, before.socket)
  before.socket.readyState = 3

  const after = announce(clients, { id: 'alpha', nonce: 'page-1' })
  assert.deepEqual(after.outcome, { ok: true })
  assert.equal(clients.size, 1, 'the old socket keeps no entry, or every call is ambiguous')
  assert.equal(clients.has(before.socket), false)
  assert.equal(reaches(clients, 'alpha').client, after.client, 'calls reach the reloaded page')
  assert.equal(clients.get(after.socket).since, first, 'one page attached once')
})

test('a reload that beats its own socket closing waits, then takes the name back', () => {
  const clients = new Map()
  const before = announce(clients, { id: 'alpha', nonce: 'page-1' })

  // The reloaded page announces while the socket it replaces is still open.
  // The server cannot tell it from a second page, so it waits its turn.
  const early = announce(clients, { id: 'alpha', nonce: 'page-1' })
  assert.equal(early.outcome.error, 'name-taken')
  assert.equal(reaches(clients, 'alpha').client, before.client)

  // The beacon announces again on a timer, so the wait ends by itself.
  before.socket.readyState = 3
  const again = announce(clients, { id: 'alpha', nonce: 'page-1', socket: early.socket })
  assert.deepEqual(again.outcome, { ok: true })
  assert.equal(clients.size, 1)
  assert.equal(reaches(clients, 'alpha').client, again.client)
})

test('two live pages with one nonce: the second is refused', () => {
  // Chrome copies sessionStorage into a tab opened with window.open, so the
  // copy announces the original's nonce while the original is still running.
  const clients = new Map()
  const real = announce(clients, { id: 'alpha', nonce: 'vvgdqtd8' })
  const copy = announce(clients, { id: 'alpha', nonce: 'vvgdqtd8' })

  assert.equal(copy.outcome.error, 'name-taken', 'a copied nonce proves nothing')
  assert.equal(clients.has(copy.socket), false)
  assert.equal(reaches(clients, 'alpha').client, real.client, 'the call reaches the page that ran')

  // Closing the copy must leave the original reachable, not "unknown-client".
  copy.socket.readyState = 3
  assert.equal(reaches(clients, 'alpha').client, real.client)
})

test('nothing a second page can announce evicts a live incumbent', () => {
  // The whole guard, stated once: while the holder's socket is open, every
  // shape of second announcement leaves the name where it was.
  const shapes = [
    { nonce: 'page-1' },                      // the holder's own nonce, copied
    { nonce: 'page-2' },                      // a nonce of its own
    { nonce: '' },                            // an empty one
    {},                                       // none at all
    { nonce: 'page-1', hidden: true },
    { nonce: 'page-1', headless: true },
    { nonce: 'page-1', url: 'http://elsewhere/' }
  ]
  for (const shape of shapes) {
    const clients = new Map()
    const real = announce(clients, { id: 'alpha', nonce: 'page-1' })
    const said = JSON.stringify(shape)

    const second = announce(clients, { id: 'alpha', ...shape })
    assert.equal(second.outcome.error, 'name-taken', `${said} took a live name`)
    assert.equal(clients.size, 1, `${said} left two entries`)
    assert.equal(reaches(clients, 'alpha').client, real.client, `${said} redirected the call`)
    assert.equal(chooseClient([...clients.values()], 'alpha').error, undefined,
      `${said} made the name unanswerable`)
  }
})

test('a second page claiming a live name is refused, and the first keeps it', () => {
  const clients = new Map()
  const real = announce(clients, { id: 'alpha', nonce: 'page-1' })
  const impostor = announce(clients, { id: 'alpha', nonce: 'page-2' })

  assert.equal(impostor.outcome.error, 'name-taken')
  assert.equal(impostor.outcome.ok, undefined, 'a refusal is not an insert')
  assert.equal(impostor.outcome.existing.client, real.client, 'the refusal names who holds it')
  assert.equal(clients.has(impostor.socket), false, 'nothing was stored for the impostor')
  assert.equal(clients.size, 1)

  // The whole point: the call still goes where it went before.
  assert.equal(reaches(clients, 'alpha').client, real.client)
  assert.equal(chooseClient([...clients.values()], 'alpha').error, undefined)
})

test('a refused page still works under its own name, and the real one is untouched', () => {
  const clients = new Map()
  const real = announce(clients, { id: 'alpha', nonce: 'page-1' })
  announce(clients, { id: 'alpha', nonce: 'page-2' })
  const second = announce(clients, { id: 'beta', nonce: 'page-2' })

  assert.deepEqual(second.outcome, { ok: true })
  assert.equal(reaches(clients, 'alpha').client, real.client)
  assert.equal(reaches(clients, 'beta').client, second.client)
})

test('a name with no nonce is not a name anyone can reconnect to', () => {
  const clients = new Map()
  const real = announce(clients, { id: 'alpha', nonce: 'page-1' })

  // No nonce proves nothing, so it cannot buy the name off a live page.
  assert.equal(announce(clients, { id: 'alpha' }).outcome.error, 'name-taken')
  assert.equal(announce(clients, { id: 'alpha', nonce: '' }).outcome.error, 'name-taken')
  assert.equal(reaches(clients, 'alpha').client, real.client)

  const bare = new Map()
  announce(bare, { id: 'gamma' })
  assert.equal(announce(bare, { id: 'gamma' }).outcome.error, 'name-taken',
    'two nonce-less pages are two pages, not one reconnecting')
})

test('a name whose page has gone is free again', () => {
  const clients = new Map()
  const gone = announce(clients, { id: 'alpha', nonce: 'page-1', socket: closedSocket() })
  const before = attachedLongAgo(clients, gone.socket)

  const next = announce(clients, { id: 'alpha', nonce: 'page-2' })
  assert.deepEqual(next.outcome, { ok: true })
  assert.equal(clients.size, 1, 'the closed entry went with the name')
  assert.equal(reaches(clients, 'alpha').client, next.client)
  assert.notEqual(clients.get(next.socket).since, before,
    'a different page took the name, so it attached now')
})

test('the refusal says who holds the name and how to attach anyway', () => {
  const clients = new Map()
  announce(clients, { id: 'alpha', nonce: 'page-1', headless: true })
  const { existing } = announce(clients, { id: 'alpha', nonce: 'page-2' }).outcome

  const said = explainClientError('name-taken', { wanted: 'alpha', live: [existing] })
  assert.match(said, /alpha/)
  assert.match(said, /headless/, 'what the holder is, so the reader can tell it is not them')
  assert.match(said, /\?client=/, 'a way forward, not just a no')
})

// --- the nonce the page announces -------------------------------------------

/** sessionStorage, as much of it as `ownNonce` uses. */
const storageHolding = value => {
  const held = new Map(value ? [['engine:tab-nonce', value]] : [])
  return {
    getItem: key => held.get(key) ?? null,
    setItem: (key, item) => held.set(key, item),
    held
  }
}

test('a page that started its own session keeps its nonce across reloads', () => {
  const storage = storageHolding('vvgdqtd8')
  assert.equal(ownNonce(storage, { hasOpener: false, mint: () => 'fresh' }), 'vvgdqtd8')
})

test('a page with an opener mints a nonce, because Chrome copied the one it has', () => {
  const storage = storageHolding('vvgdqtd8')
  assert.equal(ownNonce(storage, { hasOpener: true, mint: () => 'fresh' }), 'fresh')
  assert.equal(storage.held.get('engine:tab-nonce'), 'fresh',
    'the copy is overwritten, so a later reload cannot announce it either')
})

test('a first load stores the nonce it minted', () => {
  const storage = storageHolding(null)
  assert.equal(ownNonce(storage, { hasOpener: false, mint: () => 'fresh' }), 'fresh')
  assert.equal(storage.held.get('engine:tab-nonce'), 'fresh')
})

test('the tab beacon runs this same function', async () => {
  // A rule proved here and not shipped to the page guards nothing, so the
  // beacon inlines this function's own source rather than restating it.
  const config = (await import('../vite.config.js')).default
  const registry = config.plugins.find(plugin => plugin?.name === 'engine-server-registry')
  const beacon = registry.load('\0virtual:engine-tab-beacon')
  assert.ok(beacon.includes(String(ownNonce)), 'the page runs a copy of this rule')
  assert.match(beacon, /ownNonce\(sessionStorage, \{\s*hasOpener: Boolean\(window\.opener\)/,
    'and asks it about the opener this page actually has')
})

// --- picking a client -------------------------------------------------------

const client = (id, extra = {}) => ({
  client: { socket: { readyState: extra.closed ? 3 : 1 } },
  id,
  nonce: `nonce-${id}`,
  url: `http://localhost:5180/?client=${id}`,
  hidden: false,
  headless: false,
  viewport: '540x960',
  ...extra
})

test('one attached client answers without being named', () => {
  const only = client('lane-a')
  assert.equal(chooseClient([only]).chosen, only)
  assert.equal(chooseClient([only], 'lane-a').chosen, only)
})

test('a closed socket is not a client', () => {
  const gone = client('lane-a', { closed: true })
  const here = client('lane-b')
  assert.equal(chooseClient([gone, here]).chosen, here, 'the live one answers without naming')
  assert.equal(chooseClient([gone]).error, 'no-client')
  assert.equal(chooseClient([gone], 'lane-a').error, 'no-client')
})

test('several clients and no name is refused, never guessed', () => {
  const all = [client('lane-a'), client('lane-b'), client('editor', { hidden: true })]
  const { chosen, error, live } = chooseClient(all)
  assert.equal(chosen, undefined, 'nothing is picked')
  assert.equal(error, 'many-clients')
  assert.equal(live.length, 3)

  // The message has to carry what tells them apart, or naming one is guesswork.
  const said = explainClientError(error, { live, where: 'http://localhost:5180' })
  for (const id of ['lane-a', 'lane-b', 'editor']) assert.match(said, new RegExp(id))
  assert.match(said, /--client/)
  assert.match(said, /hidden/, 'a hidden client says so, since that is why it may not answer')
})

test('naming picks exactly that client', () => {
  const all = [client('lane-a'), client('lane-b')]
  assert.equal(chooseClient(all, 'lane-b').chosen.id, 'lane-b')
})

test('an unknown name lists what is attached rather than falling back', () => {
  const all = [client('lane-a')]
  const { chosen, error, live } = chooseClient(all, 'lane-z')
  assert.equal(chosen, undefined, 'it must not answer from the only other client')
  assert.equal(error, 'unknown-client')
  assert.match(explainClientError(error, { wanted: 'lane-z', live }), /lane-z[\s\S]*lane-a/)
})

test('two live entries under one name is an error, not a coin toss', () => {
  // mergeClient refuses to store this; the branch stands for an entry stored
  // any other way, and picking one of the two would send the call to a page the
  // caller never asked for.
  const twins = [client('lane-a'), client('lane-a')]
  const { chosen, error, live } = chooseClient(twins, 'lane-a')
  assert.equal(chosen, undefined)
  assert.equal(error, 'ambiguous-client')
  assert.equal(live.length, 2, 'only the twins, not every attached client')
  assert.match(explainClientError(error, { wanted: 'lane-a', live }), /more than one/)

  // One live and one closed is not ambiguous: the live one is the only answer.
  const [live1] = twins
  assert.equal(chooseClient([client('lane-a', { closed: true }), live1], 'lane-a').chosen, live1)
})

test('nothing attached says how to attach something', () => {
  const said = explainClientError('no-client', { live: [], where: 'http://localhost:5188' })
  assert.match(said, /5188/, "the server's own address, not a default one")
})

test('a client that went quiet is named, and a hidden one says why', () => {
  const hidden = explainClientError('no-reply', { chosen: client('editor', { hidden: true }), timeout: 8000 })
  assert.match(hidden, /editor/)
  assert.match(hidden, /hidden/)
  const shown = explainClientError('no-reply', { chosen: client('lane-a'), timeout: 8000 })
  assert.doesNotMatch(shown, /hidden/, 'a visible client must not be blamed on being hidden')
  assert.match(shown, /lane-a/)
})

test('neither the socket nor the nonce leaves the server', () => {
  const shown = publicClient(client('lane-a'))
  assert.equal(shown.client, undefined)
  assert.equal(shown.nonce, undefined, 'a reader of the nonce could send it back and take the name')
  assert.equal(shown.id, 'lane-a')

  const line = describeClient(client('lane-a'))
  assert.match(line, /lane-a \(540x960\)/)
  assert.doesNotMatch(line, /nonce-lane-a/)
})
