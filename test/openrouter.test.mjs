import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import net from 'node:net'
import openrouter from '../plugins/builtin/openrouter.js'
import { proxySend } from '../plugins/builtin/openrouter/proxy.mjs'

// Routing is explicit in these tests. The environment's proxy must not decide
// what a fake send sees, and no test may reach the network by accident.
const beforeProxy = process.env.OPENROUTER_PROXY_URL
process.env.OPENROUTER_PROXY_URL = ''
process.on('exit', () => {
  if (beforeProxy === undefined) delete process.env.OPENROUTER_PROXY_URL
  else process.env.OPENROUTER_PROXY_URL = beforeProxy
})

/** A world whose files live in memory, so no test touches a real key file. */
function world({ files = {} } = {}) {
  const written = new Map(Object.entries(files))
  return {
    written,
    context: {
      files: {
        async read(path) {
          if (!written.has(path)) throw new Error(`no such file: ${path}`)
          return written.get(path)
        },
        async write(path, text) { written.set(path, text) }
      },
      redraw() {}
    }
  }
}

/** A fetch that records what it was asked and answers what the test wants. */
function fakeSend(answer, { status = 200 } = {}) {
  const calls = []
  const send = async (url, options = {}) => {
    calls.push({ url, method: options.method || 'GET', headers: options.headers || {}, dispatcher: options.dispatcher, body: options.body ? JSON.parse(options.body) : null })
    return { ok: status < 400, status, text: async () => JSON.stringify(answer) }
  }
  send.calls = calls
  return send
}

const commands = Object.fromEntries(openrouter.commands.map(command => [command.id, command]))
const run = (context, id, value) => commands[id].run(context, value)

/** The environment wins over the file, so a test must control it. */
function withoutEnvironmentKey(body) {
  const before = process.env.OPENROUTER_API_KEY
  delete process.env.OPENROUTER_API_KEY
  return Promise.resolve(body()).finally(() => {
    if (before !== undefined) process.env.OPENROUTER_API_KEY = before
  })
}

function withEnvironmentKey(key, body) {
  const before = process.env.OPENROUTER_API_KEY
  process.env.OPENROUTER_API_KEY = key
  return Promise.resolve(body()).finally(() => {
    if (before === undefined) delete process.env.OPENROUTER_API_KEY
    else process.env.OPENROUTER_API_KEY = before
  })
}

test('a saved key is stored under .engine, which git ignores', async () => {
  const { context, written } = world()
  await withoutEnvironmentKey(async () => {
    const status = await run(context, 'openrouter.key', { key: 'sk-or-v1-abcdtail' })
    assert.deepEqual(status, { found: true, where: '.engine/openrouter.json', last4: 'tail' })
    assert.equal(JSON.parse(written.get('.engine/openrouter.json')).key, 'sk-or-v1-abcdtail')
  })
})

test('the status says a key is there and its last four, never the key', async () => {
  const { context } = world()
  await withEnvironmentKey('sk-or-v1-secret-tail', async () => {
    const status = await run(context, 'openrouter.key')
    assert.equal(status.where, 'OPENROUTER_API_KEY')
    assert.equal(status.last4, 'tail')
    assert.equal(JSON.stringify(status).includes('secret'), false)
  })
})

test('a key that is not an OpenRouter key is refused with where to get one', async () => {
  const { context } = world()
  await assert.rejects(() => run(context, 'openrouter.key', { key: 'sk-proj-openai' }), /starts with "sk-or-"/)
})

test('models are listed with prices per million and narrowed by a query', async () => {
  const { context } = world()
  const send = fakeSend({
    data: [
      { id: 'a/fast', name: 'Fast', context_length: 8000, pricing: { prompt: '0.0000005', completion: '0.0000015' } },
      { id: 'b/slow', name: 'Slow', context_length: 200000, pricing: { prompt: '0.000003', completion: '0.000015' } }
    ]
  })
  const listed = await run(context, 'openrouter.models', { send })
  assert.equal(listed.listed, 2)
  assert.deepEqual(listed.models[0], {
    id: 'a/fast', name: 'Fast', context: 8000, promptCostPerMillion: 0.5, answerCostPerMillion: 1.5
  })

  const narrowed = await run(context, 'openrouter.models', { query: 'slow', send })
  assert.deepEqual(narrowed.models.map(model => model.id), ['b/slow'])
})

test('listing models sends no key, so a person can look before they sign up', async () => {
  const { context } = world()
  const send = fakeSend({ data: [] })
  await run(context, 'openrouter.models', { send })
  assert.equal(send.calls[0].headers.authorization, undefined)
})

test('an ask carries the key as a bearer token and returns the text and usage', async () => {
  const { context } = world()
  const send = fakeSend({
    model: 'a/fast',
    choices: [{ message: { content: 'hello' }, finish_reason: 'stop' }],
    usage: { total_tokens: 9 }
  })
  const answer = await withEnvironmentKey('sk-or-v1-abcd', () => run(context, 'openrouter.ask', { model: 'a/fast', prompt: 'hi', send }))
  assert.equal(answer.text, 'hello')
  assert.equal(answer.usage.total_tokens, 9)
  assert.equal(send.calls[0].headers.authorization, 'Bearer sk-or-v1-abcd')
  assert.equal(send.calls[0].body.messages.at(-1).content, 'hi')
})

test('a stored key is used when the environment has none', async () => {
  const { context } = world({ files: { '.engine/openrouter.json': JSON.stringify({ key: 'sk-or-v1-stored' }) } })
  const send = fakeSend({ choices: [{ message: { content: 'ok' } }] })
  await withoutEnvironmentKey(() => run(context, 'openrouter.ask', { model: 'a/fast', prompt: 'hi', send }))
  assert.equal(send.calls[0].headers.authorization, 'Bearer sk-or-v1-stored')
})

test('a schema asks for json and comes back parsed', async () => {
  const { context } = world()
  const send = fakeSend({ choices: [{ message: { content: '{"choice":"flee","confidence":0.82}' } }] })
  const schema = {
    type: 'object', additionalProperties: false,
    properties: { choice: { type: 'string' }, confidence: { type: 'number' } },
    required: ['choice', 'confidence']
  }
  const answer = await withEnvironmentKey('sk-or-v1-abcd', () => run(context, 'openrouter.ask', { model: 'a/fast', prompt: 'flee or fight', schema, send }))
  assert.deepEqual(answer.value, { choice: 'flee', confidence: 0.82 })
  assert.equal(send.calls[0].body.response_format.type, 'json_schema')
})

test('a schema reply that is not json returns null rather than throwing', async () => {
  const { context } = world()
  const send = fakeSend({ choices: [{ message: { content: 'sorry, no' } }] })
  const answer = await withEnvironmentKey('sk-or-v1-abcd', () => run(context, 'openrouter.ask', { model: 'a/fast', prompt: 'x', schema: { type: 'object' }, send }))
  assert.equal(answer.value, null)
  assert.equal(answer.text, 'sorry, no')
})

test('an ask with no key says how to set one, and asks nothing of the network', async () => {
  const { context } = world()
  const send = fakeSend({})
  await withoutEnvironmentKey(async () => {
    await assert.rejects(() => run(context, 'openrouter.ask', { model: 'a/fast', prompt: 'hi', send }), /no OpenRouter key is set/)
    assert.equal(send.calls.length, 0)
  })
})

test('an ask with no model names the verb that lists them', async () => {
  const { context } = world()
  await assert.rejects(() => run(context, 'openrouter.ask', { prompt: 'hi' }), /openrouter\.models/)
})

test('a refusal from OpenRouter is reported with what it said', async () => {
  const { context } = world()
  const send = fakeSend({ error: { message: 'insufficient credits' } }, { status: 402 })
  await assert.rejects(
    () => withEnvironmentKey('sk-or-v1-abcd', () => run(context, 'openrouter.ask', { model: 'a/fast', prompt: 'hi', send })),
    /insufficient credits/
  )
})

test('a key check with no key says so instead of asking the network', async () => {
  const { context } = world()
  const send = fakeSend({})
  await withoutEnvironmentKey(async () => {
    assert.deepEqual(await run(context, 'openrouter.check', { send }), { ok: false, why: 'no key is set' })
    assert.equal(send.calls.length, 0)
  })
})

test('forgetting the key leaves no key behind', async () => {
  const { context } = world({ files: { '.engine/openrouter.json': JSON.stringify({ key: 'sk-or-v1-gone' }) } })
  await withoutEnvironmentKey(async () => {
    assert.deepEqual(await run(context, 'openrouter.key', { clear: true }), { found: false, where: null, last4: null })
  })
})

test('a decisions call posts the decisions route with state and questions, not messages', async () => {
  const { context } = world()
  const send = fakeSend({
    model: 'typesafe/jev-1.13-20260917', provider: 'TypeSafe',
    answers: { question: { type: 'choice', choice: 'yes', confidence: 0.9 } },
    usage: { input_tokens: 10, output_tokens: 2, cost: 0.000001 }
  })
  const reply = await withEnvironmentKey('sk-or-v1-abcd', () => run(context, 'openrouter.decisions', {
    state: { task: 'x' },
    questions: { question: { type: 'choice', instructions: 'is x?', criteria: { yes: 'y', no: 'n' } } },
    send
  }))
  assert.equal(send.calls[0].url, 'https://openrouter.ai/api/alpha/decisions')
  assert.equal(send.calls[0].headers.authorization, 'Bearer sk-or-v1-abcd')
  assert.equal(send.calls[0].body.model, 'typesafe/jev-1.13')
  assert.deepEqual(send.calls[0].body.state, { task: 'x' })
  assert.ok(send.calls[0].body.questions.question)
  assert.equal(send.calls[0].body.messages, undefined)
  assert.equal(reply.answers.question.choice, 'yes')
  assert.equal(reply.usage.cost, 0.000001)
})

test('a decisions call with no key asks nothing of the network', async () => {
  const { context } = world()
  const send = fakeSend({})
  await withoutEnvironmentKey(async () => {
    await assert.rejects(
      () => run(context, 'openrouter.decisions', { state: { a: 1 }, questions: { q: { type: 'noul', instructions: 'x' } }, send }),
      /no OpenRouter key/)
    assert.equal(send.calls.length, 0)
  })
})

test('a configured proxy selects a node tunnel, and no proxy selects none', async () => {
  const { proxySend } = await import('../plugins/builtin/openrouter/proxy.mjs')
  assert.equal(await proxySend(null), undefined)
  assert.equal(await proxySend(''), undefined)
  const tunnelled = await proxySend('http://127.0.0.1:10808')
  assert.equal(typeof tunnelled, 'function', 'a configured proxy must produce a transport')
})

test('an injected transport is used as given, so a test never opens a socket', async () => {
  const { context } = world()
  const send = fakeSend({ model: 'm', answers: { q: { type: 'noul', noul: 0.5 } } })
  await withEnvironmentKey('sk-or-v1-abcd', () => run(context, 'openrouter.decisions', {
    state: { a: 1 }, questions: { q: { type: 'noul', instructions: 'x' } }, send
  }))
  assert.equal(send.calls.length, 1)
  assert.equal(send.calls[0].dispatcher, undefined)
})

test('a decisions reply that is not JSON is a refusal, not a crash', async () => {
  const { context } = world()
  const send = async () => ({ ok: true, status: 200, text: async () => 'not json' })
  await withEnvironmentKey('sk-or-v1-abcd', async () => {
    await assert.rejects(
      () => run(context, 'openrouter.decisions', { state: { a: 1 }, questions: { q: { type: 'noul', instructions: 'x' } }, send }),
      /no answers/)
  })
})

test('a hanging decisions request is cut off by the timeout and never retried', async () => {
  const { context } = world()
  let calls = 0
  const send = (url, options) => {
    calls++
    return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('aborted'))))
  }
  await withEnvironmentKey('sk-or-v1-abcd', async () => {
    await assert.rejects(
      () => run(context, 'openrouter.decisions', { state: { a: 1 }, questions: { q: { type: 'noul', instructions: 'x' } }, send, timeoutMs: 20 }),
      /aborted/)
  })
  assert.equal(calls, 1)
})

/** Listen on an ephemeral localhost port and answer it. */
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)))
/** Close a server, destroying any tunnel socket the test left open. */
const close = server => {
  for (const socket of server.tunnels || []) socket.destroy()
  server.closeAllConnections?.()
  return new Promise(resolve => server.close(resolve))
}

/** A CONNECT proxy whose per-connection behaviour the test states. */
function proxyWith(onConnect) {
  const proxy = http.createServer((request, response) => { response.writeHead(405); response.end() })
  proxy.tunnels = new Set()
  proxy.on('connect', (request, socket, head) => {
    proxy.tunnels.add(socket)
    socket.on('close', () => proxy.tunnels.delete(socket))
    socket.on('error', () => { /* the client aborted; the test asserts the outcome */ })
    onConnect(request, socket, head)
  })
  return proxy
}

test('a stalled CONNECT reply is cut off by abort', { timeout: 5000 }, async t => {
  const proxy = proxyWith(() => { /* accept and never answer */ })
  const port = await listen(proxy)
  t.after(() => close(proxy))
  const send = await proxySend(`http://127.0.0.1:${port}`)
  const controller = new AbortController()
  const started = Date.now()
  const request = send('https://example.invalid/', { method: 'GET', headers: {}, signal: controller.signal })
  setTimeout(() => controller.abort(), 40)
  await assert.rejects(request, /aborted/)
  assert.ok(Date.now() - started < 2000, 'abort must not wait for the connect to answer')
})

test('a stalled TLS handshake is cut off by abort', { timeout: 5000 }, async t => {
  const proxy = proxyWith((request, socket) => {
    socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
    // Then never speak TLS.
  })
  const port = await listen(proxy)
  t.after(() => close(proxy))
  const send = await proxySend(`http://127.0.0.1:${port}`)
  const controller = new AbortController()
  const started = Date.now()
  const request = send('https://example.invalid/', { method: 'GET', headers: {}, signal: controller.signal })
  setTimeout(() => controller.abort(), 60)
  await assert.rejects(request, /aborted/)
  assert.ok(Date.now() - started < 2000, 'abort must not wait for TLS to finish')
})

test('a stalled response body is cut off by abort, and the tunnel socket is destroyed', { timeout: 5000 }, async t => {
  let bodySocketClosed
  const closed = new Promise(resolve => { bodySocketClosed = resolve })
  const body = http.createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/plain' })
    response.write('partial')
    response.on('close', bodySocketClosed)
    // Then never end.
  })
  const bodyPort = await listen(body)
  t.after(() => close(body))
  const proxy = proxyWith((request, clientSocket, head) => {
    const upstream = net.connect(bodyPort, '127.0.0.1', () => {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      if (head?.length) upstream.write(head)
      upstream.pipe(clientSocket)
      clientSocket.pipe(upstream)
    })
    upstream.on('error', () => { /* the client aborted */ })
  })
  const proxyPort = await listen(proxy)
  t.after(() => close(proxy))
  const send = await proxySend(`http://127.0.0.1:${proxyPort}`)
  const controller = new AbortController()
  const request = send(`http://127.0.0.1:${bodyPort}/`, {
    method: 'GET', headers: { host: `127.0.0.1:${bodyPort}` }, signal: controller.signal
  })
  setTimeout(() => controller.abort(), 80)
  await assert.rejects(request, /aborted/)
  await Promise.race([closed, new Promise((resolve, reject) => setTimeout(() => reject(new Error('the body socket stayed open')), 2000))])
})

test('an http request through the tunnel returns the reply', { timeout: 5000 }, async t => {
  const body = http.createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ ok: true, path: request.url }))
  })
  const bodyPort = await listen(body)
  t.after(() => close(body))
  const proxy = proxyWith((request, clientSocket, head) => {
    const upstream = net.connect(bodyPort, '127.0.0.1', () => {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      if (head?.length) upstream.write(head)
      upstream.pipe(clientSocket)
      clientSocket.pipe(upstream)
    })
    upstream.on('error', () => { /* closed by the client */ })
  })
  const proxyPort = await listen(proxy)
  t.after(() => close(proxy))
  const send = await proxySend(`http://127.0.0.1:${proxyPort}`)
  const reply = await send(`http://127.0.0.1:${bodyPort}/answer`, {
    method: 'GET', headers: { host: `127.0.0.1:${bodyPort}` }
  })
  assert.equal(reply.ok, true)
  assert.equal(reply.status, 200)
  assert.deepEqual(JSON.parse(await reply.text()), { ok: true, path: '/answer' })
})
