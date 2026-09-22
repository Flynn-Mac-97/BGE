import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { registerManaged, finishManaged, supervisorEvent } from '../engine/supervisor.mjs'

const require = createRequire(import.meta.url)
const MAXIMUM_OUTPUT = 1024 * 1024
const PROVIDERS = ['shell', 'codex', 'claude', 'pi']

export function findExecutable(name, environment = process.env) {
  const extensions = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : ['']
  const search = environment.PATH || environment.Path || ''
  for (const directory of search.split(path.delimiter)) {
    for (const extension of extensions) {
      const file = path.join(directory.replace(/^"|"$/g, ''), name + extension)
      try { if (fs.statSync(file).isFile()) return file } catch { /* try the next path */ }
    }
  }
  return null
}

export function createTerminals(supervisor, { spawn, environment = process.env } = {}) {
  const sessions = new Map()
  const providers = () => PROVIDERS.map(id => ({ id, available: id === 'shell' || !!findExecutable(id, environment) }))
  const get = id => {
    const session = sessions.get(id)
    if (!session) throw new Error(`No terminal named ${id}`)
    return session
  }
  function start({ provider = 'shell', cwd, project = cwd, client, port }) {
    if (!PROVIDERS.includes(provider)) throw new Error('Unknown agent provider')
    if (!cwd || !fs.statSync(cwd).isDirectory()) throw new Error('Choose an existing working directory')
    if (sessions.size >= 24) {
      const old = [...sessions.values()].find(session => session.exitCode !== null)
      if (old) sessions.delete(old.entry.id)
      else throw new Error('Stop a terminal before opening another (24 are running)')
    }
    const executable = provider === 'shell' ? null : findExecutable(provider, environment)
    if (provider !== 'shell' && !executable) throw new Error(`${provider} is not installed or is not on PATH. Install it, then reopen the engine.`)
    const windows = process.platform === 'win32'
    const command = provider === 'shell'
      ? (windows ? findExecutable('pwsh', environment) || 'powershell.exe' : environment.SHELL || '/bin/sh')
      : windows && /\.(cmd|bat)$/i.test(executable) ? environment.ComSpec || 'cmd.exe' : executable
    const args = provider === 'shell' ? (windows ? ['-NoLogo'] : [])
      : windows && /\.(cmd|bat)$/i.test(executable) ? `/d /s /c ""${executable}""` : []
    const env = { ...environment, TERM: 'xterm-256color', ENGINE_CHECKOUT: supervisor.checkout }
    delete env.ELECTRON_RUN_AS_NODE
    if (client) env.ENGINE_CLIENT = client
    if (port) env.ENGINE_PORT = String(port)
    env.ENGINE_PROJECT = project
    env.ENGINE_NODE = process.execPath
    const pathKey = Object.keys(env).find(key => key.toLowerCase() === 'path') || 'PATH'
    env[pathKey] = path.join(supervisor.checkout, 'bin') + path.delimiter + (env[pathKey] || '')
    const terminal = (spawn || require('node-pty').spawn)(command, args, {
      name: 'xterm-256color', cwd, env, cols: 100, rows: 24, useConptyDll: windows
    })
    let resolveExit
    const exited = new Promise(resolve => { resolveExit = resolve })
    const entry = registerManaged(supervisor, {
      kind: provider === 'shell' ? 'terminal' : 'agent', label: provider,
      pid: terminal.pid, cwd, client: client || null, port: null, provider
    }, () => stop(entry.id))
    const session = { entry, terminal, text: '', offset: 0, exitCode: null, exited }
    sessions.set(entry.id, session)
    terminal.onData(data => {
      session.text += data
      session.offset += data.length
      if (session.text.length > MAXIMUM_OUTPUT) session.text = session.text.slice(-MAXIMUM_OUTPUT)
      entry.lastOutputAt = new Date().toISOString()
    })
    terminal.onExit(({ exitCode }) => {
      session.exitCode = exitCode
      entry.state = 'exited'
      entry.exitCode = exitCode
      finishManaged(supervisor, entry, `exit ${exitCode}`)
      resolveExit()
    })
    return { id: entry.id }
  }
  async function stop(id) {
    const session = get(id)
    if (session.exitCode !== null) return
    session.terminal.kill()
    let timer
    await Promise.race([session.exited, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Terminal ${id} has not exited`)), 5000)
    })]).finally(() => clearTimeout(timer))
  }
  return {
    providers, start, stop,
    list: () => [...sessions.values()].map(session => ({ ...session.entry })),
    read(id, offset = 0) {
      const session = get(id)
      const begin = session.offset - session.text.length
      const from = Math.max(begin, Number(offset) || 0)
      const text = session.text.slice(from - begin, from - begin + 65536)
      return { text, offset: from + text.length, truncated: offset < begin, exitCode: session.exitCode }
    },
    write(id, text) {
      if (typeof text !== 'string' || text.length > 65536) throw new Error('Terminal input is too large')
      const session = get(id)
      if (session.exitCode !== null) throw new Error('This terminal has exited')
      session.terminal.write(text)
    },
    resize(id, columns, rows) {
      if (![columns, rows].every(value => Number.isInteger(value) && value > 0 && value <= 1000)) throw new Error('Invalid terminal size')
      const session = get(id)
      if (session.exitCode === null) session.terminal.resize(columns, rows)
    },
    interrupt(id) {
      get(id).terminal.write('\x03')
      supervisorEvent(supervisor, id, 'interrupt', 'Ctrl+C sent')
    },
    async close() { await Promise.all([...sessions.keys()].map(stop)) }
  }
}
