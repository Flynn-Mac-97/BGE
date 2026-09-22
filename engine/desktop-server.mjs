import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { WebSocketServer } from 'ws'
import { watch } from 'chokidar'
import { engineServerConfig } from './server-config.mjs'
import { ensureProject, resolveProject } from './project-path.mjs'

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.wav': 'audio/wav', '.woff2': 'font/woff2' }
const inside = (file, root) => {
  const relative = path.relative(root, file)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

// The built editor needs file routes, project watches, and its command bridge.
// These are the same handlers used by Vite; only the HTTP and socket adapter differs.
export async function startDesktopServer({ root, project, port = 0, desktopSnapshot, desktopCapture }) {
  await ensureProject(resolveProject(root, project))
  const config = engineServerConfig({ root, project, desktop: true, desktopSnapshot, desktopCapture })
  const middleware = []
  const events = new EventEmitter()
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 * 1024 })
  const watcher = watch([], { ignoreInitial: true })
  const server = http.createServer(async (request, response) => {
    try {
      const origin = request.headers.origin
      if (origin && origin !== `http://${request.headers.host}`) {
        response.writeHead(403); response.end('Origin refused'); return
      }
      let position = 0
      const next = async () => {
        if (middleware[position]) return middleware[position++](request, response, next)
        return serve(request, response)
      }
      await next()
    } catch (error) {
      if (!response.headersSent) response.writeHead(500, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: error.message }))
    }
  })
  const adapter = {
    config,
    httpServer: server,
    watcher,
    middlewares: { use: handler => middleware.push(handler) },
    ws: {
      on: (event, callback) => events.on(event, callback),
      send: (event, data) => {
        for (const socket of sockets.clients) if (socket.readyState === 1) socket.send(JSON.stringify({ event, data }))
      }
    }
  }
  async function serve(request, response) {
    const pathname = decodeURIComponent(request.url.split('?')[0])
    const file = pathname.startsWith('/@fs/')
      ? path.resolve(pathname.slice(5))
      : path.resolve(root, 'dist', pathname === '/' ? 'index.html' : '.' + pathname)
    const roots = pathname.startsWith('/@fs/') ? config.server.fs.allow : [path.join(root, 'dist')]
    const real = await fs.realpath(file).catch(() => null)
    const allowed = await Promise.all(roots.map(folder => fs.realpath(folder).catch(() => folder)))
    if (!real || !allowed.some(folder => inside(real, folder))) {
      response.writeHead(404); response.end('Not found'); return
    }
    const bytes = await fs.readFile(real)
    response.writeHead(200, { 'content-type': MIME[path.extname(real)] || 'application/octet-stream', 'cache-control': 'no-cache' })
    response.end(bytes)
  }
  server.on('upgrade', (request, socket, head) => {
    if (request.url !== '/engine-events' || request.headers.origin !== `http://${request.headers.host}`) {
      socket.destroy(); return
    }
    sockets.handleUpgrade(request, socket, head, client => {
      const peer = { socket: client, send: (event, data) => client.send(JSON.stringify({ event, data })) }
      client.on('message', bytes => {
        try { const message = JSON.parse(bytes); events.emit(message.event, message.data, peer) } catch { /* invalid message */ }
      })
    })
  })
  try {
    for (const plugin of config.plugins) await plugin.configureServer?.(adapter)
    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(port, '127.0.0.1', resolve)
    })
  } catch (error) {
    await watcher.close()
    server.close()
    throw error
  }
  config.server.port = server.address().port
  return {
    port: config.server.port,
    url: `http://127.0.0.1:${config.server.port}/`,
    async close() {
      await watcher.close()
      for (const socket of sockets.clients) socket.terminate()
      sockets.close()
      server.closeAllConnections()
      await new Promise(resolve => server.close(resolve))
    }
  }
}
