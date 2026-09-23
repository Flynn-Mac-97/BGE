/**
 * Kernel: the supervisor's HTTP and process plumbing.
 *
 * Split from `supervisor.mjs` so that file stays within the line budget. These
 * helpers are generic — ask a port, read a body, answer JSON, start a detached
 * process — and carry no supervisor state.
 */
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { spawn } from 'node:child_process'

/** A refusal a caller caused, which the route answers with 400 rather than 500. */
export const badRequest = message => Object.assign(new Error(message), { statusCode: 400 })

/**
 * The loopback addresses a server may answer on.
 *
 * A dev server binds `localhost`, which resolves to the IPv6 address first on
 * Windows, and a Chrome debugging port binds `127.0.0.1`. Asking one address
 * reports a healthy server as unresponsive, which is the one answer a prover
 * must never give, so both are asked in turn.
 */
const LOOPBACK_HOSTS = ['127.0.0.1', '::1']

/**
 * Ask one address for a JSON answer, or null when nothing answers.
 *
 * `node:http` with `agent: false`, not fetch: fetch keeps its connection in a
 * pool this code cannot close, and a socket still closing when the CLI exits
 * aborts the process on Windows with a libuv assertion.
 */
function requestOnHost(host, port, method, requestPath, body, milliseconds = 1500) {
  return new Promise(resolve => {
    const payload = body == null ? null : JSON.stringify(body)
    const request = http.request(
      {
        host,
        port,
        path: requestPath,
        method,
        agent: false,
        timeout: milliseconds,
        headers: payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {}
      },
      response => {
        let text = ''
        response.setEncoding('utf8')
        response.on('data', chunk => {
          text += chunk
        })
        response.once('end', () => {
          request.destroy()
          let parsed
          try {
            parsed = text ? JSON.parse(text) : null
          } catch {
            parsed = null
          }
          resolve({ status: response.statusCode, body: parsed, text })
        })
      }
    )
    const fail = () => {
      request.destroy()
      resolve(null)
    }
    request.once('error', fail)
    request.once('timeout', fail)
    if (payload) request.write(payload)
    request.end()
  })
}

/** Ask a port on either loopback address, and take the first answer. */
export async function requestOnPort(port, method, requestPath, body, milliseconds = 1500) {
  for (const host of LOOPBACK_HOSTS) {
    const answer = await requestOnHost(host, port, method, requestPath, body, milliseconds)
    if (answer) return answer
  }
  return null
}

/** Read a request body as text. */
export function readBody(request) {
  return new Promise((resolve, reject) => {
    let text = ''
    request.setEncoding('utf8')
    request.on('data', chunk => {
      text += chunk
    })
    request.once('end', () => resolve(text))
    request.once('error', reject)
  })
}

/** Parse a body, treating an empty one as absent. */
export function parseJson(text) {
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    throw badRequest('the request body is not JSON')
  }
}

/** One JSON reply, with the length set so the socket closes cleanly. */
export function sendJson(response, status, value) {
  const body = JSON.stringify(value)
  response.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body)
  })
  response.end(body)
}

/** Bind and resolve, so a port already in use rejects the start. */
export function listen(server, port) {
  return new Promise((resolve, reject) => {
    const failed = error => reject(error)
    server.once('error', failed)
    server.listen(port, '127.0.0.1', () => {
      server.off('error', failed)
      resolve()
    })
  })
}

/** Stop accepting connections. In-flight replies are given a moment, then cut. */
export function closeServer(server) {
  return new Promise(resolve => {
    if (!server || !server.listening) {
      resolve()
      return
    }
    server.close(() => resolve())
    server.closeIdleConnections?.()
    setTimeout(() => server.closeAllConnections?.(), 200)
  })
}

/** Start a detached process with its output in the instance log. */
export function spawnDetached(command, args, { cwd, env, logPath }) {
  fs.mkdirSync(path.dirname(logPath), { recursive: true })
  const log = fs.openSync(logPath, 'a')
  try {
    const child = spawn(command, args, {
      cwd,
      env: { ...env, ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {}) },
      detached: true,
      windowsHide: true,
      stdio: ['ignore', log, log]
    })
    child.unref()
    return child
  } finally {
    fs.closeSync(log)
  }
}

/** The supervisor record path for a checkout. */
const supervisorRecordFile = checkout =>
  path.join(process.env.ENGINE_STATE_ROOT || path.join(checkout, '.engine'), 'supervisor.json')

/** The supervisor record on disk, or null when it is missing or broken. */
export function readSupervisorRecord(checkout) {
  try {
    return JSON.parse(fs.readFileSync(supervisorRecordFile(checkout), 'utf8'))
  } catch {
    return null
  }
}

/** Write the record only once the port is bound, so a reader never sees a port that is not there. */
export function writeSupervisorRecord(checkout, record) {
  const file = supervisorRecordFile(checkout)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(record, null, 2) + '\n', 'utf8')
}

/** Remove the record. A missing file is already the goal. */
export function removeSupervisorRecord(checkout) {
  try {
    fs.unlinkSync(supervisorRecordFile(checkout))
  } catch {
    /* already gone */
  }
}
