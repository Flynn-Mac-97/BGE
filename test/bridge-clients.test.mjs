import test from 'node:test'
import assert from 'node:assert/strict'

import { chooseClient, explainClientError, publicClient, describeClient } from '../engine/bridge-clients.mjs'

const client = (id, extra = {}) => ({
  client: { socket: { readyState: extra.closed ? 3 : 1 } },
  id,
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

test('two clients claiming one name is an error, not a coin toss', () => {
  const twins = [client('lane-a'), client('lane-a')]
  const { error, live } = chooseClient(twins, 'lane-a')
  assert.equal(error, 'ambiguous-client')
  assert.equal(live.length, 2)
  assert.match(explainClientError(error, { wanted: 'lane-a', live }), /more than one/)
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

test('the socket never leaves the server', () => {
  const shown = publicClient(client('lane-a'))
  assert.equal(shown.client, undefined)
  assert.equal(shown.id, 'lane-a')
  assert.match(describeClient(client('lane-a')), /lane-a \(540x960\)/)
})
