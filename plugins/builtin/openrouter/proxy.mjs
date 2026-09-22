/**
 * Request-scoped proxy routing for OpenRouter.
 *
 * The engine runs in a browser and in node. A person may need OpenRouter reached
 * through an HTTP proxy while the agent's own model stays direct, so the proxy is
 * attached to one request and never to a global dispatcher or to the process
 * environment. `OPENROUTER_PROXY_URL` names it.
 *
 * The tunnel is built from node's own `http` and `tls`, so the adapter adds no
 * dependency. The browser cannot set a proxy for fetch: there the variable is
 * absent, `proxySend` answers undefined, and the request goes direct. That is a
 * limit of the platform, not a fallback this module can fix.
 *
 * Cancellation stays armed through every phase — CONNECT, the TLS handshake and
 * reading the whole body. A phase that settles early would leave a stalled peer
 * with nothing to destroy and the request hanging past its timeout.
 */

/** The configured proxy URL, or null when OpenRouter is reached directly. */
export function openRouterProxy() {
  return typeof process !== 'undefined' && process.env?.OPENROUTER_PROXY_URL
    ? process.env.OPENROUTER_PROXY_URL
    : null
}

/** Whether this runtime can open a socket. The browser cannot. */
const canTunnel = () => typeof process !== 'undefined' && Boolean(process.versions?.node)

/**
 * A fetch-shaped send that reaches one proxy, or undefined when there is no
 * proxy or no socket to open.
 *
 * A configured proxy that fails refuses the request; falling back to a direct
 * call would leak past the proxy the caller asked for.
 */
export async function proxySend(proxyUrl) {
  if (!proxyUrl || !canTunnel()) return undefined
  const [http, tls] = await Promise.all([import('node:http'), import('node:tls')])
  const proxy = new URL(proxyUrl)

  /**
   * One phase of the request.
   *
   * `run` registers the one resource the phase is waiting on, so abort destroys
   * it and rejects at once. The listener is removed only when the phase settles,
   * not when its first byte arrives.
   */
  function phase(signal, run) {
    if (signal?.aborted) return Promise.reject(new Error('aborted'))
    return new Promise((resolve, reject) => {
      let resource = null
      let finished = false
      const finish = (error, value) => {
        if (finished) return
        finished = true
        signal?.removeEventListener('abort', onAbort)
        if (error) reject(error)
        else resolve(value)
      }
      const onAbort = () => {
        const error = new Error('aborted')
        resource?.destroy?.(error)
        finish(error)
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      run({
        use: value => { resource = value },
        done: value => finish(null, value),
        fail: error => finish(error)
      })
    })
  }

  /** CONNECT to the target through the proxy, then add TLS for an https target. */
  const openTunnel = (target, signal) => phase(signal, ({ use, done, fail }) => {
    const connect = http.request({
      host: proxy.hostname,
      port: Number(proxy.port || 80),
      method: 'CONNECT',
      path: `${target.hostname}:${target.port || 443}`,
      headers: { host: `${target.hostname}:${target.port || 443}` },
      ...(proxy.username ? { auth: `${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}` } : {})
    })
    use(connect)
    connect.once('connect', (response, socket) => {
      if (response.statusCode !== 200) {
        socket.destroy()
        fail(new Error(`the proxy refused CONNECT: HTTP ${response.statusCode}`))
        return
      }
      if (signal?.aborted) { socket.destroy(); return }
      if (target.protocol !== 'https:') {
        use(socket)
        done(socket)
        return
      }
      const secure = tls.connect({ socket, servername: target.hostname })
      use(secure)
      secure.once('secureConnect', () => done(secure))
      secure.once('error', fail)
    })
    connect.once('error', fail)
    connect.end()
  })

  /** One HTTP exchange over the already-open socket, shaped like a fetch reply. */
  const exchange = (socket, target, { method, headers, body }, signal) => phase(signal, ({ use, done, fail }) => {
    const agent = new http.Agent({ keepAlive: false })
    // The socket is already a tunnel to the target; handing it to the agent
    // makes http write the request over it instead of dialing a new connection.
    agent.createConnection = () => socket
    const request = http.request({
      path: `${target.pathname}${target.search}`,
      method,
      headers: { ...headers, host: target.host },
      agent
    }, response => {
      // The body is not read yet; the response is what abort destroys now.
      use(response)
      const chunks = []
      response.on('data', chunk => chunks.push(chunk))
      response.on('end', () => done({
        ok: response.statusCode >= 200 && response.statusCode < 300,
        status: response.statusCode,
        text: async () => Buffer.concat(chunks).toString('utf8')
      }))
      response.on('error', fail)
    })
    use(request)
    request.once('error', fail)
    if (body !== undefined) request.write(body)
    request.end()
  })

  return async (url, options = {}) => {
    const target = new URL(url)
    if (target.protocol !== 'https:' && target.protocol !== 'http:') {
      throw new Error('the OpenRouter proxy tunnels HTTP and HTTPS only')
    }
    if (options.signal?.aborted) throw new Error('aborted')
    const socket = await openTunnel(target, options.signal)
    try {
      return await exchange(socket, target, options, options.signal)
    } finally {
      // One tunnel serves one request; the reply is fully read by now.
      socket.destroy()
    }
  }
}
