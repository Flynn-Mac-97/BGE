import { app, BrowserWindow, WebContentsView, ipcMain, dialog } from 'electron'
import path from 'node:path'
import fs from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { startSupervisor, supervisorAddress, askSupervisor, registerManaged, updateManaged, finishManaged, supervisorEvent, spawnInstance, stopInstance } from '../engine/supervisor.mjs'
import { startDesktopServer } from '../engine/desktop-server.mjs'
import { createTerminals } from './terminals.mjs'
import { captureEditor } from './capture.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const SHELL_FILE = path.join(HERE, 'console.html')
let window, supervisor, terminals, backend, backendEntry
let active = null, consoleHeight = 300, quitting = false
const views = new Map()
const desktopCapture = async options => {
  const captured = await captureEditor(window, views, active, options)
  if (captured.client !== active) throw new Error('The active view changed during capture; try again')
  return captured
}
const desktopSnapshot = () => ({ supported: true, active, instances: supervisor.instances })

function layout() {
  if (!window || window.isDestroyed()) return
  const [width, height] = window.getContentSize()
  const bottom = Math.min(Math.max(consoleHeight, 180), height - 100)
  for (const [id, { view, entry }] of views) {
    view.setBounds({ x: 0, y: 48, width, height: Math.max(1, height - bottom - 48) })
    view.setVisible(id === active)
    updateManaged(supervisor, entry, { showing: id === active ? 'visible' : 'hidden' })
  }
}

function log(id, event, detail) {
  if (supervisor) supervisorEvent(supervisor, id, event, detail)
  if (process.env.ENGINE_DESKTOP_SMOKE) console.log(`[${id}] ${event}: ${detail}`)
}

async function closeView(id) {
  const item = views.get(id)
  if (!item) return
  views.delete(id)
  window.contentView.removeChildView(item.view)
  item.view.webContents.close()
  finishManaged(supervisor, item.entry)
  if (active === id) active = views.keys().next().value || null
  layout()
}

async function openView() {
  if (!backend) throw new Error('The engine backend is not ready')
  const view = new WebContentsView({ webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false } })
  const entry = registerManaged(supervisor, { kind: 'engine-view', label: `Engine ${views.size + 1}`, pid: null, parent: backendEntry.id, state: 'starting' }, () => closeView(entry.id))
  views.set(entry.id, { view, entry })
  active = entry.id
  window.contentView.addChildView(view)
  const url = `${backend.url}?client=${encodeURIComponent(entry.id)}`
  updateManaged(supervisor, entry, { url, client: entry.id })
  view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  view.webContents.on('will-navigate', (event, target) => { if (new URL(target).origin !== new URL(backend.url).origin) event.preventDefault() })
  view.webContents.on('did-finish-load', () => updateManaged(supervisor, entry, { state: 'running', pid: view.webContents.getOSProcessId() }))
  view.webContents.on('did-fail-load', (_event, code, description) => {
    if (code === -3) return
    updateManaged(supervisor, entry, { state: 'failed' })
    log(entry.id, 'error', description)
  })
  view.webContents.on('render-process-gone', (_event, details) => {
    updateManaged(supervisor, entry, { state: 'failed' })
    log(entry.id, 'error', `Renderer exited: ${details.reason}`)
  })
  view.webContents.on('console-message', event => log(entry.id, event.level >= 2 ? 'error' : 'output', event.message))
  layout()
  await view.webContents.loadURL(url)
  return { id: entry.id }
}

async function projectInfo() {
  if (!backend) return { directory: ROOT, project: 'Starting engine' }
  return (await fetch(new URL('api/project', backend.url))).json()
}

async function command({ action, ...args }) {
  switch (action) {
    case 'capture': return desktopCapture(args)
    case 'snapshot': return {
      instances: supervisor.instances, events: supervisor.events, terminals: terminals.list(),
      providers: terminals.providers(), active, project: await projectInfo(), root: ROOT, development: !app.isPackaged
    }
    case 'terminal.start': {
      const project = await projectInfo()
      return terminals.start({ ...args, cwd: args.cwd || project.directory, project: project.directory, client: active, port: backend?.port })
    }
    case 'terminal.read': return terminals.read(args.id, args.offset)
    case 'terminal.write': terminals.write(args.id, args.text); return { ok: true }
    case 'terminal.resize': terminals.resize(args.id, args.columns, args.rows); return { ok: true }
    case 'terminal.interrupt': terminals.interrupt(args.id); return { ok: true }
    case 'terminal.stop': await terminals.stop(args.id); return { ok: true }
    case 'engine.open': return openView()
    case 'engine.activate':
      if (!views.has(args.id)) throw new Error('That engine view is no longer open')
      active = args.id; layout(); return { ok: true }
    case 'engine.reload':
      if (!views.has(active)) throw new Error('Open an engine view first')
      views.get(active).view.webContents.reload(); return { ok: true }
    case 'instance.stop':
      if (args.id === backendEntry?.id) throw new Error('The application backend stops when you quit the engine')
      return stopInstance(supervisor, args.id)
    case 'dev.start':
      if (app.isPackaged) throw new Error('Start development servers from a source checkout')
      return spawnInstance(supervisor, { kind: 'dev-server', checkout: ROOT })
    case 'console.layout':
      if (!Number.isFinite(args.height)) throw new Error('Invalid console height')
      consoleHeight = args.height; layout(); return { ok: true }
    case 'folder.choose': {
      const result = await dialog.showOpenDialog(window, { properties: ['openDirectory'] })
      return { path: result.canceled ? null : result.filePaths[0] }
    }
    case 'project.open': {
      if (!backend) throw new Error('The backend is not ready')
      const response = await fetch(new URL('api/project/open', backend.url), {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: args.path })
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error)
      for (const { view } of views.values()) view.webContents.reload()
      return body
    }
    default: throw new Error(`Unknown desktop action: ${action}`)
  }
}

export async function startDesktop() {
  if (process.env.ENGINE_DESKTOP_SMOKE) app.setPath('userData', path.join(path.dirname(process.env.ENGINE_DESKTOP_SMOKE), 'electron'))
  if (!app.requestSingleInstanceLock()) { app.quit(); return }
  app.on('second-instance', () => { window?.show(); window?.focus() })
  await app.whenReady()
  if (app.isPackaged) {
    process.env.ENGINE_STATE_ROOT ||= path.join(app.getPath('userData'), 'state')
    process.env.ENGINE_PROJECTS_ROOT ||= path.join(app.getPath('documents'), 'Engine Projects')
  }
  const previous = await supervisorAddress(ROOT)
  if (previous) {
    await askSupervisor(ROOT, 'POST', '/handoff', {})
    for (let attempt = 0; attempt < 40 && await supervisorAddress(ROOT); attempt++) await new Promise(resolve => setTimeout(resolve, 50))
  }
  supervisor = await startSupervisor(ROOT, { port: 0 })
  terminals = createTerminals(supervisor)
  supervisor.desktopCommand = command
  window = new BrowserWindow({ width: 1440, height: 960, minWidth: 800, minHeight: 520, show: false, backgroundColor: '#111318', autoHideMenuBar: true,
    webPreferences: { preload: path.join(HERE, 'console-preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  })
  const shellURL = pathToFileURL(SHELL_FILE).href
  ipcMain.handle('desktop:command', (event, request) => {
    if (quitting || window.isDestroyed() || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== shellURL) throw new Error('Desktop sender refused')
    return command(request)
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', event => event.preventDefault())
  window.on('resize', layout)
  window.on('close', event => { if (!quitting) { event.preventDefault(); void shutdown() } })
  app.on('before-quit', event => { if (!quitting) { event.preventDefault(); void shutdown() } })
  await window.loadFile(SHELL_FILE)
  window.show()
  try {
    if (process.env.ENGINE_DESKTOP_DEV === '1' && !app.isPackaged) {
      const { createServer } = await import('vite')
      const { engineServerConfig } = await import('../engine/server-config.mjs')
      const config = engineServerConfig({ root: ROOT, desktop: true, desktopSnapshot, desktopCapture })
      const server = await createServer({ ...config, root: ROOT, configFile: false, server: { ...config.server, host: '127.0.0.1', port: 0 } })
      await server.listen()
      backend = { port: server.httpServer.address().port, close: () => server.close() }
      backend.url = `http://127.0.0.1:${backend.port}/`
    } else {
      await fs.access(path.join(ROOT, 'dist/index.html'))
      backend = await startDesktopServer({ root: ROOT, project: process.env.ENGINE_PROJECT, desktopSnapshot, desktopCapture })
    }
    backendEntry = registerManaged(supervisor, { kind: 'engine-backend', label: 'Engine backend', pid: process.pid, port: backend.port, url: backend.url }, async () => {
      for (const id of [...views.keys()]) await closeView(id)
      await backend.close()
      finishManaged(supervisor, backendEntry)
    })
    await openView()
    if (process.env.ENGINE_DESKTOP_SMOKE) {
      const { smokeDesktop } = await import('./smoke.mjs')
      await smokeDesktop({ command, window, views, supervisor, backend })
      await shutdown()
    }
  } catch (error) {
    log('desktop', 'error', error.stack || error.message)
    if (process.env.ENGINE_DESKTOP_SMOKE) { console.error(error); process.exitCode = 1; await shutdown() }
  }
}

async function shutdown() {
  if (quitting) return
  quitting = true
  try {
    await terminals?.close()
    for (const id of [...views.keys()]) await closeView(id)
    await supervisor?.close()
  } catch (error) {
    quitting = false
    log('desktop', 'error', `Could not quit: ${error.message}`)
    return
  }
  window?.destroy()
  app.exit(process.exitCode || 0)
}
